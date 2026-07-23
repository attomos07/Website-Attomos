package services

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/api/drive/v3"
)

// =============================================================================
// NOTIFICACIONES PUSH DE DRIVE — para que los cambios en la hoja se detecten
// solos, sin depender de que el usuario le dé clic a "Actualizar" ni de
// esperar al polling. Google avisa a un webhook nuestro cuando el archivo
// cambia. La suscripción vence sola (máx. ~7 días) y hay que renovarla — ver
// RenewExpiringInventoryWatches en el handler.
// =============================================================================

// WatchResult es lo que Google devuelve al crear la suscripción.
type WatchResult struct {
	ChannelID  string
	ResourceID string
	Expiration time.Time
}

// WatchSpreadsheetFile suscribe un canal de notificaciones push para el
// archivo (spreadsheet) indicado. webhookURL es la URL pública donde Google
// nos va a avisar; channelToken es un secreto propio para verificar que el
// aviso realmente viene de esa suscripción (Google lo regresa tal cual en
// cada notificación, en el header X-Goog-Channel-Token).
func (s *GoogleSheetsService) WatchSpreadsheetFile(ctx context.Context, tokenJSON, fileID, channelID, webhookURL, channelToken string) (*WatchResult, error) {
	driveSvc, err := s.createDriveService(ctx, tokenJSON)
	if err != nil {
		return nil, err
	}

	// Google permite hasta ~7 días; pedimos 6 para tener margen de sobra
	// antes de que la renovación automática tenga que correr.
	expiresAt := time.Now().Add(6 * 24 * time.Hour)

	channel := &drive.Channel{
		Id:         channelID,
		Type:       "web_hook",
		Address:    webhookURL,
		Token:      channelToken,
		Expiration: expiresAt.UnixMilli(),
	}

	resp, err := driveSvc.Files.Watch(fileID, channel).Do()
	if err != nil {
		return nil, fmt.Errorf("error suscribiendo notificaciones de Drive: %w", err)
	}

	result := &WatchResult{
		ChannelID:  resp.Id,
		ResourceID: resp.ResourceId,
		Expiration: expiresAt,
	}
	if resp.Expiration > 0 {
		result.Expiration = time.UnixMilli(resp.Expiration)
	}
	return result, nil
}

// StopWatchChannel cancela una suscripción activa (se usa al desconectar la
// hoja, para no dejar canales huérfanos avisando de cambios que ya nadie lee).
func (s *GoogleSheetsService) StopWatchChannel(ctx context.Context, tokenJSON, channelID, resourceID string) error {
	if channelID == "" || resourceID == "" {
		return nil
	}
	driveSvc, err := s.createDriveService(ctx, tokenJSON)
	if err != nil {
		return err
	}
	channel := &drive.Channel{Id: channelID, ResourceId: resourceID}
	if err := driveSvc.Channels.Stop(channel).Do(); err != nil {
		return fmt.Errorf("error cancelando la suscripción de Drive: %w", err)
	}
	return nil
}
