## Import-Lead Webhook – Setup-Anleitung für Make.com

### Endpoint

```
POST https://wlalcftxyqozrmzcywus.supabase.co/functions/v1/import-lead
```

### Headers

| Header | Wert |
|--------|------|
| `Content-Type` | `application/json` |
| `x-webhook-key` | Dein WEBHOOK_API_KEY (den du als Secret gesetzt hast) |

### Body (JSON)

```json
{
  "full_name": "{{Name}}",
  "phone": "{{Telefon}}",
  "company_name": "{{Firma}}",
  "platform": "fb",
  "campaign_name": "{{Kampagnenname}}",
  "ad_name": "{{Anzeigenname}}",
  "is_entrepreneur": true,
  "has_more_than_5_employees": true,
  "employees_info": "{{Mitarbeiter-Antwort}}",
  "created_at": "{{Datum}}"
}
```

### Felder

- `platform`: `"fb"` für Facebook, `"ig"` für Instagram
- `is_entrepreneur` / `has_more_than_5_employees`: optional, KI ermittelt diese wenn nicht angegeben
- `employees_info`: optionaler Freitext (z.B. "50+_mitarbeiter"), hilft der KI bei der Qualifizierung
- `created_at`: ISO-Datum, optional (Default: jetzt)

### KI-Qualifizierung

Die KI analysiert automatisch:
- Ob der Lead ein Unternehmer ist
- Mitarbeiterzahl-Einschätzung
- Pipeline-Stufe (new / qualified / unqualified)
