# Portal czasowego dostępu do Home Assistanta

*[English version](README.md)*

Portal pozwala wysłać gościowi link z PIN-em do czasowego sterowania wybranymi encjami Home Assistanta. HA nie jest wystawiony do internetu: to on sam łączy się z portalem przez WebSocket, a portal tylko przekazuje kliknięcia gości.

Portal działa na Cloudflare Workers (darmowy plan) i obsługuje wiele instancji HA naraz. Nowe instancje rejestrują się jednorazowymi kodami zaproszeń wystawianymi przez administratora.

Integracja Home Assistanta: [ha-access-integration](https://github.com/pgpotasiak/ha-access-integration). Licencja MIT.

## Wdrożenie (bez instalowania czegokolwiek na komputerze)

1. **Repozytorium.** Na GitHubie utwórz nowe repozytorium (np. `ha-access-portal`, na razie prywatne). Wybierz „uploading an existing file” i przeciągnij całą zawartość rozpakowanego archiwum, razem z folderami `src` i `test`. Zatwierdź przyciskiem „Commit changes”.
2. **Baza danych.** W panelu Cloudflare wejdź w *Storage & databases → D1 SQL database → Create*. Nazwa: `access-db`. Po utworzeniu skopiuj **Database ID**.
3. **ID bazy w konfiguracji.** Na GitHubie otwórz plik `wrangler.jsonc`, kliknij ikonę ołówka i zamień `00000000-0000-0000-0000-000000000000` na skopiowane ID. Zatwierdź zmianę.
4. **Podłączenie repozytorium.** W Cloudflare: *Workers & Pages → Create application → Connect GitHub*. Zezwól Cloudflare na dostęp do repozytorium i wybierz je. Nazwa projektu musi brzmieć `access` (tak jak `name` w `wrangler.jsonc`). Polecenie budowania zostaw puste, polecenie wdrożenia: `npx wrangler deploy`. Kliknij *Deploy*.
5. **Sekrety.** Po pierwszym wdrożeniu wejdź w Worker `access` → *Settings → Variables and Secrets → Add*. Dodaj dwie wartości typu **Secret**:
   - `PIN_PEPPER` – losowy ciąg co najmniej 32 znaków. **Nie zmieniaj go później**, bo przestaną działać PIN-y istniejących paneli.
   - `ADMIN_TOKEN` – losowy ciąg co najmniej 32 znaków; to Twoje hasło administratora portalu.

   Wygeneruj je np. w menedżerze haseł. Zapisz `ADMIN_TOKEN` w bezpiecznym miejscu.
6. **Sprawdzenie.** Otwórz `https://access.<twoja-subdomena>.workers.dev`. Powinien pojawić się tekst *Home Assistant temporary access portal.*

Każda kolejna zmiana wrzucona do repozytorium wdraża się automatycznie. Zmiany w bazie danych (nowe kolumny) portal wprowadza sam przy pierwszym uruchomieniu nowej wersji.

## Strona administratora

Otwórz `https://access.<twoja-subdomena>.workers.dev/admin` i zaloguj się wartością sekretu `ADMIN_TOKEN`. Na stronie:

- **Zaproś dom**: generuje jednorazowy kod zaproszenia (ważny od 1 dnia do 2 lat) i gotową wiadomość dla znajomego z instrukcją, do skopiowania jednym kliknięciem.
- **Niewykorzystane kody**: lista kodów, których nikt jeszcze nie użył, z możliwością anulowania.
- **Podłączone domy**: nazwa, data dołączenia, liczba aktywnych paneli, stan online oraz blokowanie i odblokowanie domu.

Sesja trwa 12 godzin. 10 błędnych prób logowania z jednego adresu IP blokuje logowanie z niego na 15 minut.

## Kod zaproszenia z wiersza poleceń

Zamiast strony administratora można użyć terminala (Windows: PowerShell, polecenie `curl.exe`; macOS i Linux: `curl`):

```
curl.exe -X POST https://access.iloveha.workers.dev/api/v1/admin/invites -H "Authorization: Bearer TWOJ_ADMIN_TOKEN"
```

Odpowiedź zawiera `invite_code` ważny 7 dni. Wpisuje się go przy dodawaniu integracji w Home Assistancie. Każdy kod działa jeden raz, więc dla każdego znajomego wystaw osobny.

## API

Szczegóły w pliku `src/index.ts`. Wszystkie odpowiedzi są w JSON.

| Metoda i ścieżka | Uwierzytelnienie | Działanie |
| --- | --- | --- |
| `GET /admin` | – | Strona administratora |
| `POST /api/v1/admin/session` | `ADMIN_TOKEN` w treści | Logowanie strony administratora (ciasteczko na 12 h) |
| `POST /api/v1/admin/invites` | `ADMIN_TOKEN` | Nowy kod zaproszenia (`ttl_days` od 1 do 730, domyślnie 7) |
| `GET /api/v1/admin/invites` | `ADMIN_TOKEN` | Niewykorzystane kody (bez samych kodów) |
| `DELETE /api/v1/admin/invites/{id}` | `ADMIN_TOKEN` | Anulowanie niewykorzystanego kodu |
| `GET /api/v1/admin/instances` | `ADMIN_TOKEN` | Lista instancji (bez nazw kontrolek i dzienników) |
| `POST /api/v1/admin/instances/{id}/block` | `ADMIN_TOKEN` | Blokada (`{"blocked": true}`) lub odblokowanie instancji |
| `POST /api/v1/instances` | kod zaproszenia | Rejestracja instancji, zwraca `instance_id` i `api_key` |
| `GET /api/v1/instances/{id}/ws?after={seq}` | klucz instancji | WebSocket: polecenia gości do HA, potwierdzenia od HA |
| `POST /api/v1/panels` | klucz instancji | Nowy panel, zwraca `panel_url` |
| `GET /api/v1/panels` | klucz instancji | Lista paneli z aktualnym stanem |
| `GET /api/v1/panels/{id}` | klucz instancji | Panel z kontrolkami i licznikami użyć |
| `DELETE /api/v1/panels/{id}` | klucz instancji | Natychmiastowe unieważnienie |
| `POST /api/v1/panels/{id}/unlock` | klucz instancji | Odblokowanie po zbyt wielu błędnych PIN-ach |
| `GET /api/v1/panels/{id}/log?since={id}` | klucz instancji | Dziennik zdarzeń panelu |

### Protokół WebSocket

Po połączeniu portal wysyła `{"type":"hello", "server_time", "command_ttl_ms": 30000}`, a potem zaległe polecenia o numerze większym niż `after`.

- Polecenie: `{"type":"command", "seq", "panel_id", "control_id", "action", "ts"}`, gdzie `action` to `on`, `off` albo `press`.
- Wartość do pokazania gościowi (od HA): `{"type":"state", "panel_id", "control_id", "state", "unit", "device_class", "domain"}`. Portal przechowuje tylko ostatnią wartość i pokazuje ją wyłącznie dla kontrolek typu `sensor` albo z `show_state: true`.
- Potwierdzenie od HA: `{"type":"ack", "seq", "result": "ok"}` albo `{"type":"ack", "seq", "result": "rejected", "reason": "outside_schedule"}`.
- Podtrzymanie: HA wysyła `{"type":"ping"}` co 30 s i dostaje `{"type":"pong"}` bez budzenia Durable Objectu.
- Kody zamknięcia: `4001` – zastąpione nowym połączeniem, `4003` – instancja zablokowana.

Polecenia starsze niż 30 s wygasają i nie są wykonywane.

## Zabezpieczenia

- Link zawiera 128 losowych bitów; PIN jest przechowywany jako HMAC z sekretem `PIN_PEPPER`.
- 5 błędnych PIN-ów z jednego IP blokuje je na 15 minut; 20 błędnych łącznie blokuje panel do odblokowania przez właściciela.
- Sesja gościa: ciasteczko `HttpOnly`, `Secure`, `SameSite=Strict`, maksymalnie 12 h i nie dłużej niż panel.
- Klucze instancji, kody zaproszeń i tokeny sesji są przechowywane wyłącznie jako skróty SHA-256.
- Portal nie zna `entity_id`. Mapowanie kontrolek na encje i ostateczna kontrola ważności odbywają się w Home Assistancie.
- Strona gościa nie ładuje niczego z zewnętrznych serwerów (ścisły nagłówek CSP).
- Panele wygasłe lub unieważnione ponad 7 dni temu są usuwane codziennie razem z dziennikiem.

## Praca lokalna (dla programistów)

```
npm install
cp .dev.vars.example .dev.vars
npm run dev                 # portal na http://127.0.0.1:8787
npm run test:e2e            # 79 testów end-to-end, w tym udawany HA
node test/fake-ha.mjs       # udawany HA do ręcznych testów strony gościa
```
