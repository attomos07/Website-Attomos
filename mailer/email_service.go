package mailer

import (
	"fmt"
	"net/smtp"
	"os"
	"time"
)

// EmailService envía correos transaccionales vía SMTP (Zoho Mail).
//
// Variables de entorno esperadas:
//
//	SMTP_HOST     (default: smtp.zoho.com)
//	SMTP_PORT     (default: 587)
//	SMTP_USERNAME (default: contact@attomos.com)
//	SMTP_PASSWORD (REQUERIDO — contraseña de aplicación de Zoho, sin default)
//	SMTP_FROM     (default: "Attomos <contact@attomos.com>")
type EmailService struct {
	host     string
	port     string
	username string
	password string
	from     string
}

func NewEmailService() *EmailService {
	return &EmailService{
		host:     getEnvOrDefault("SMTP_HOST", "smtp.zoho.com"),
		port:     getEnvOrDefault("SMTP_PORT", "587"),
		username: getEnvOrDefault("SMTP_USERNAME", "contact@attomos.com"),
		password: os.Getenv("SMTP_PASSWORD"),
		from:     getEnvOrDefault("SMTP_FROM", "Attomos <contact@attomos.com>"),
	}
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// SendPasswordResetCode manda el correo con el código de 4 dígitos para
// recuperar contraseña.
func (s *EmailService) SendPasswordResetCode(toEmail, code string) error {
	if s.password == "" {
		return fmt.Errorf("SMTP_PASSWORD no está configurado")
	}

	subject := "Tu código para recuperar tu contraseña — Attomos"
	body := buildPasswordResetEmailHTML(code)

	msg := []byte(
		"From: " + s.from + "\r\n" +
			"To: " + toEmail + "\r\n" +
			"Subject: " + subject + "\r\n" +
			"MIME-Version: 1.0\r\n" +
			"Content-Type: text/html; charset=UTF-8\r\n" +
			"\r\n" + body,
	)

	auth := smtp.PlainAuth("", s.username, s.password, s.host)
	addr := fmt.Sprintf("%s:%s", s.host, s.port)

	return smtp.SendMail(addr, auth, s.username, []string{toEmail}, msg)
}

// buildPasswordResetEmailHTML arma el HTML del correo de recuperación con un
// diseño consistente con la marca (header con logo, tarjeta central para el
// código, footer con aviso de seguridad). Usa solo estilos inline porque la
// mayoría de clientes de correo ignoran <style> en el <head>.
func buildPasswordResetEmailHTML(code string) string {
	logoURL := getEnvOrDefault("ATTOMOS_LOGO_URL", "https://attomos.com/static/images/attomos-logo-email.png")

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#06b6d4,#0891b2);padding:28px 32px;text-align:center;">
              <img src="%s" alt="Attomos" height="28" style="height:28px;display:inline-block;">
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 8px 32px;">
              <div style="width:52px;height:52px;background-color:#ecfeff;border-radius:50%%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px auto;text-align:center;line-height:52px;font-size:24px;">🔐</div>
              <h1 style="margin:0 0 8px 0;font-size:20px;line-height:1.3;color:#0f172a;text-align:center;font-weight:700;">Recupera tu contraseña</h1>
              <p style="margin:0 0 28px 0;font-size:14px;line-height:1.6;color:#64748b;text-align:center;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta de Attomos. Usa el siguiente código para continuar:
              </p>

              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
                    <span style="font-size:34px;font-weight:800;letter-spacing:12px;color:#0891b2;font-family:'Courier New',monospace;">%s</span>
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">
                Este código expira en <strong style="color:#64748b;">30 minutos</strong>.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <div style="border-top:1px solid #e2e8f0;"></div>
            </td>
          </tr>

          <!-- Security note -->
          <tr>
            <td style="padding:20px 32px 32px 32px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;text-align:center;">
                Si tú no solicitaste este código, puedes ignorar este correo con tranquilidad — tu contraseña no cambiará. Nunca compartas este código con nadie, ni siquiera con alguien que diga ser de Attomos.
              </p>
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr>
            <td style="padding:20px 8px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                © %d Attomos · <a href="mailto:contact@attomos.com" style="color:#94a3b8;">contact@attomos.com</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`, logoURL, code, time.Now().Year())
}
