package mailer

// attachments.go — correo con adjuntos (lo usa Punto de venta → Corte de
// caja para mandar el reporte en PDF / Excel). Mismo SMTP que el resto.

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime"
	"net/smtp"
	"strings"
	"time"
)

// Attachment — un archivo adjunto.
type Attachment struct {
	Name string
	Type string
	Data []byte
}

// Enabled: ¿hay contraseña SMTP configurada?
func (s *EmailService) Enabled() bool { return s.password != "" }

// From — remitente con el que salen los correos.
func (s *EmailService) From() string { return s.from }

// SendWithAttachments manda un correo HTML con adjuntos. bcc va oculto.
func (s *EmailService) SendWithAttachments(to, bcc []string, subject, htmlBody string, atts []Attachment) error {
	if s.password == "" {
		return fmt.Errorf("SMTP_PASSWORD no está configurado")
	}
	clean := func(list []string) []string {
		out := []string{}
		for _, e := range list {
			e = strings.TrimSpace(e)
			if e != "" && !strings.ContainsAny(e, "\r\n") {
				out = append(out, e)
			}
		}
		return out
	}
	to, bcc = clean(to), clean(bcc)
	if len(to) == 0 {
		return fmt.Errorf("falta el destinatario")
	}
	boundary := fmt.Sprintf("attomos-%d", time.Now().UnixNano())
	var b bytes.Buffer
	b.WriteString("From: " + s.from + "\r\n")
	b.WriteString("To: " + strings.Join(to, ", ") + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("UTF-8", strings.ReplaceAll(subject, "\n", " ")) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	writeB64(&b, []byte(htmlBody))

	for _, a := range atts {
		ctype := a.Type
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		name := mime.QEncoding.Encode("UTF-8", strings.NewReplacer("\"", "", "\r", "", "\n", "").Replace(a.Name))
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: " + ctype + "; name=\"" + name + "\"\r\n")
		b.WriteString("Content-Disposition: attachment; filename=\"" + name + "\"\r\n")
		b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
		writeB64(&b, a.Data)
	}
	b.WriteString("--" + boundary + "--\r\n")

	auth := smtp.PlainAuth("", s.username, s.password, s.host)
	addr := fmt.Sprintf("%s:%s", s.host, s.port)
	return smtp.SendMail(addr, auth, s.username, append(to, bcc...), b.Bytes())
}

func writeB64(b *bytes.Buffer, data []byte) {
	enc := base64.StdEncoding.EncodeToString(data)
	for len(enc) > 76 {
		b.WriteString(enc[:76] + "\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc + "\r\n")
}
