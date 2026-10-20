package google

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
)

// =============================================================================
// ATTOMOS FOUNDATION — foto de perfil en el Google Drive de la rescatista
//
// Scope drive.file: Attomos solo ve los archivos que él mismo crea. La foto
// se guarda en la carpeta "Attomos Foundation" de su Drive.
// =============================================================================

const FoundationDriveFolder = "Attomos Foundation"

// ErrFoundationDriveGone el archivo ya no existe o se revocó el acceso.
var ErrFoundationDriveGone = errors.New("archivo no disponible en Drive")

// FoundationDrive envuelve la config OAuth de la integración de Google.
type FoundationDrive struct {
	cfg *oauth2.Config
}

// NewFoundationDrive usa las mismas credenciales que la integración de Google
// (GOOGLE_INTEGRATION_*), con su propio redirect:
// GOOGLE_FOUNDATION_REDIRECT_URL o BASE_URL + /api/foundation/google/callback.
// Ese redirect debe estar dado de alta en Google Cloud Console.
func NewFoundationDrive() (*FoundationDrive, error) {
	clientID := firstEnv("GOOGLE_FOUNDATION_CLIENT_ID", "GOOGLE_INTEGRATION_CLIENT_ID", "GOOGLE_CLIENT_ID")
	clientSecret := firstEnv("GOOGLE_FOUNDATION_CLIENT_SECRET", "GOOGLE_INTEGRATION_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET")
	redirect := os.Getenv("GOOGLE_FOUNDATION_REDIRECT_URL")
	if redirect == "" {
		base := strings.TrimRight(os.Getenv("BASE_URL"), "/")
		if base != "" {
			redirect = base + "/api/foundation/google/callback"
		}
	}
	if clientID == "" || clientSecret == "" || redirect == "" {
		return nil, fmt.Errorf("faltan credenciales de Google para Foundation (GOOGLE_INTEGRATION_CLIENT_ID/SECRET y GOOGLE_FOUNDATION_REDIRECT_URL o BASE_URL)")
	}
	return &FoundationDrive{cfg: &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirect,
		Scopes: []string{
			"https://www.googleapis.com/auth/drive.file",
			"https://www.googleapis.com/auth/userinfo.email",
		},
		Endpoint: google.Endpoint,
	}}, nil
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

// AuthURL URL de consentimiento. prompt=consent garantiza refresh token.
func (d *FoundationDrive) AuthURL(state string) string {
	return d.cfg.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent"))
}

// Exchange intercambia el código por un token y lo devuelve serializado.
func (d *FoundationDrive) Exchange(ctx context.Context, code string) (string, *oauth2.Token, error) {
	tok, err := d.cfg.Exchange(ctx, code)
	if err != nil {
		return "", nil, err
	}
	b, err := json.Marshal(tok)
	if err != nil {
		return "", nil, err
	}
	return string(b), tok, nil
}

// Email correo de la cuenta de Google conectada.
func (d *FoundationDrive) Email(ctx context.Context, tok *oauth2.Token) string {
	resp, err := d.cfg.Client(ctx, tok).Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var info struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&info)
	return info.Email
}

// Session servicio de Drive con un token guardado. Si Google renueva el
// access token, NewToken() devuelve el JSON nuevo para guardarlo en BD.
type FoundationDriveSession struct {
	Service *drive.Service
	src     oauth2.TokenSource
	orig    string
}

func (d *FoundationDrive) Session(ctx context.Context, tokenJSON string) (*FoundationDriveSession, error) {
	if strings.TrimSpace(tokenJSON) == "" {
		return nil, ErrFoundationDriveGone
	}
	var tok oauth2.Token
	if err := json.Unmarshal([]byte(tokenJSON), &tok); err != nil {
		return nil, fmt.Errorf("token de Google inválido: %w", err)
	}
	src := oauth2.ReuseTokenSource(&tok, d.cfg.TokenSource(ctx, &tok))
	svc, err := drive.NewService(ctx, option.WithTokenSource(src))
	if err != nil {
		return nil, err
	}
	return &FoundationDriveSession{Service: svc, src: src, orig: tokenJSON}, nil
}

// NewToken JSON del token si cambió (renovado), o "" si sigue igual.
func (s *FoundationDriveSession) NewToken() string {
	t, err := s.src.Token()
	if err != nil {
		return ""
	}
	var old oauth2.Token
	_ = json.Unmarshal([]byte(s.orig), &old)
	if t.AccessToken == old.AccessToken {
		return ""
	}
	// conservar refresh token si Google no lo regresó
	if t.RefreshToken == "" {
		t.RefreshToken = old.RefreshToken
	}
	b, _ := json.Marshal(t)
	return string(b)
}

// EnsureFolder crea (o reutiliza) la carpeta "Attomos Foundation".
func (s *FoundationDriveSession) EnsureFolder(folderID string) (string, error) {
	if folderID != "" && s.folderAlive(folderID) {
		return folderID, nil
	}
	return s.folder(FoundationDriveFolder)
}

func (s *FoundationDriveSession) folderAlive(id string) bool {
	f, err := s.Service.Files.Get(id).Fields("id, trashed").Do()
	return err == nil && !f.Trashed
}

func (s *FoundationDriveSession) folder(name string) (string, error) {
	q := fmt.Sprintf("name = '%s' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents", strings.ReplaceAll(name, "'", "\\'"))
	res, err := s.Service.Files.List().Q(q).Fields("files(id)").PageSize(1).Do()
	if err != nil {
		return "", fmt.Errorf("error buscando carpeta %q: %w", name, err)
	}
	if len(res.Files) > 0 {
		return res.Files[0].Id, nil
	}
	f := &drive.File{
		Name:        name,
		MimeType:    "application/vnd.google-apps.folder",
		Description: "Foto de perfil de tu página en Attomos Foundation. Si la borras, dejará de verse en tu página.",
	}
	created, err := s.Service.Files.Create(f).Fields("id").Do()
	if err != nil {
		return "", fmt.Errorf("error creando carpeta %q: %w", name, err)
	}
	return created.Id, nil
}

// Upload sube una imagen a la carpeta indicada y devuelve su fileId.
func (s *FoundationDriveSession) Upload(folderID, name, mime string, data []byte) (string, error) {
	f := &drive.File{Name: name, Parents: []string{folderID}, MimeType: mime}
	created, err := s.Service.Files.Create(f).Media(bytes.NewReader(data), googleapi.ContentType(mime)).Fields("id").Do()
	if err != nil {
		return "", fmt.Errorf("error subiendo a Drive: %w", err)
	}
	return created.Id, nil
}

// FileState estado de un archivo para avisarle a la rescatista.
type FoundationFileState struct {
	Exists  bool
	Trashed bool
}

func (s *FoundationDriveSession) State(fileID string) (FoundationFileState, error) {
	f, err := s.Service.Files.Get(fileID).Fields("id, trashed").Do()
	if err != nil {
		if isDriveGone(err) {
			return FoundationFileState{}, nil
		}
		return FoundationFileState{}, err
	}
	return FoundationFileState{Exists: true, Trashed: f.Trashed}, nil
}

// Download descarga el contenido (funciona aunque esté en la papelera) y dice
// si el archivo está en la papelera. Son 2 llamadas: metadatos + contenido.
func (s *FoundationDriveSession) Download(fileID string, maxBytes int64) ([]byte, string, bool, error) {
	meta, err := s.Service.Files.Get(fileID).Fields("id, mimeType, trashed").Do()
	if err != nil {
		if isDriveGone(err) {
			return nil, "", false, ErrFoundationDriveGone
		}
		return nil, "", false, err
	}
	resp, err := s.Service.Files.Get(fileID).Download()
	if err != nil {
		if isDriveGone(err) {
			return nil, "", false, ErrFoundationDriveGone
		}
		return nil, "", false, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, "", false, err
	}
	if int64(len(data)) > maxBytes {
		return nil, "", false, fmt.Errorf("imagen demasiado grande")
	}
	return data, meta.MimeType, meta.Trashed, nil
}

func isDriveGone(err error) bool {
	var gerr *googleapi.Error
	if errors.As(err, &gerr) {
		return gerr.Code == 404 || gerr.Code == 403 || gerr.Code == 401
	}
	var rerr *oauth2.RetrieveError
	if errors.As(err, &rerr) {
		return true // refresh token revocado
	}
	return false
}

// IsFoundationAuthRevoked true si el token de Google ya no sirve.
func IsFoundationAuthRevoked(err error) bool {
	var rerr *oauth2.RetrieveError
	return errors.As(err, &rerr)
}

// FoundationDriveTimeout contexto con tiempo límite para llamadas a Drive.
func FoundationDriveTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 25*time.Second)
}
