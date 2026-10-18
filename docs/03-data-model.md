# 03. Модель даних та формат збереження (Крок 2)

## 3.1 Принципи
1. **Git-friendly**: один запит — один файл, стабільний порядок ключів, без часових міток у файлах (крім історії), `\n` переноси, UTF-8 без BOM.
2. **Людиночитний YAML** для робочих файлів; **JSON** — для експорту одним файлом і для внутрішніх стан-файлів.
3. **Версіонування**: кожен кореневий файл має `schemaVersion`; міграції в `storage/migrate.rs` виконуються при відкритті (з бекапом `.bak`).
4. **Ідентифікатори**: UUID v7 у полі `id` — стабільні при перейменуванні/переміщенні файлів (посилання між сутностями йдуть по `id`, не по шляху).
5. **Без секретів у файлах**: лише посилання `secretRef`.
6. Невідомі поля зберігаються при перезаписі (`#[serde(flatten)] extra`) — сумісність з новішими версіями.

## 3.2 Розміщення на диску

```
my-workspace/                          ← корінь workspace (комітиться в Git)
├─ apipulse.workspace.yaml
├─ environments/
│  ├─ _globals.yaml
│  ├─ dev.env.yaml
│  └─ staging.env.yaml
├─ databases/
│  ├─ pg-dev.db.yaml
│  └─ local-sqlite.db.yaml
├─ collections/
│  └─ users-api/
│     ├─ _collection.yaml
│     ├─ users/
│     │  ├─ _folder.yaml
│     │  ├─ list-users.req.yaml
│     │  └─ create-user.req.yaml
│     └─ billing-soap/
│        ├─ _folder.yaml
│        └─ get-invoice.req.yaml
├─ scenarios/                         ← див. 06-scenarios.md
│  └─ orders/                         ← Suite
│     ├─ _suite.yaml
│     ├─ create-order.scenario.yaml
│     └─ fixtures/
│        └─ seed-users.sql
└─ .apipulse/                          ← локальне, у .gitignore (створюється автоматично)
   ├─ local.env.yaml                   ← локальні перевизначення змінних (не в Git)
   └─ runtime-vars.json                ← змінні, записані екстракторами
```

App-data (поза workspace, `%APPDATA%/api-pulse`, `~/Library/Application Support/api-pulse`, `~/.local/share/api-pulse`):
```
settings.json         ← налаштування додатка
state.json            ← останні workspace, відкриті вкладки, розміри панелей, активне оточення
drafts/<tabId>.json   ← незбережені чернетки вкладок
history/<workspaceId>.jsonl ← історія виконань (append-only, ротація)
logs/
```

Імена файлів — slug від назви (`Create user` → `create-user.req.yaml`), колізії → суфікс `-2`. Перейменування в UI перейменовує файл.

## 3.3 Workspace

```yaml
schemaVersion: 1
id: 01928f3a-7c1e-7b2a-9d4e-1a2b3c4d5e6f
name: My Project
defaults:
  timeoutMs: 30000
  followRedirects: true
  verifyTls: true
```

## 3.4 Collection / Folder

`_collection.yaml`:
```yaml
schemaVersion: 1
id: 0192...a1
name: Users API
description: Public users service
order: 0
variables:
  - { key: apiVersion, value: v2, enabled: true }
auth:
  type: bearer
  token: "{{accessToken}}"
headers:
  - { key: X-Client, value: api-pulse, enabled: true }
```

`_folder.yaml` — ті ж поля `id, name, description, order, variables, auth, headers` (без `schemaVersion`; береться від колекції).

**Успадкування**: `auth: { type: inherit }` (за замовчуванням) → бере найближчого предка. `headers` предків зливаються (дочірні перевизначають за ключем без урахування регістру).

## 3.5 Request (REST)

```yaml
id: 0192...b7
type: http
name: Create user
order: 1
method: POST
url: "{{baseUrl}}/{{apiVersion}}/users"
params:
  query:
    - { key: notify, value: "false", enabled: true }
  path: []
headers:
  - { key: Content-Type, value: application/json, enabled: true }
auth:
  type: inherit
body:
  type: json
  raw: |
    {
      "email": "{{$randomEmail}}",
      "name": "Test User"
    }
settings:
  timeoutMs: null          # null → успадкувати
  followRedirects: null
  verifyTls: null
extract:
  - id: 0192...e1
    enabled: true
    variable: userId
    scope: runtime         # runtime | environment | global
    source: { kind: jsonBody, path: "$.id" }
  - id: 0192...e2
    enabled: true
    variable: email
    scope: runtime
    source: { kind: jsonBody, path: "$.email" }
dbChecks:
  - id: 0192...d1
    enabled: true
    name: userRow
    connectionId: 0192...c1          # посилання на databases/*.db.yaml за id
    sql: SELECT id, email, status FROM users WHERE id = :userId
    params:
      - { name: userId, value: "{{userId}}", type: auto }
    waitBeforeMs: 0
    retry: { attempts: 3, intervalMs: 500 }
    maxRows: 100
assertions:
  - id: 0192...a1
    enabled: true
    actual: { kind: status }
    operator: eq
    expected: { kind: literal, value: 201 }
  - id: 0192...a2
    enabled: true
    actual: { kind: jsonBody, path: "$.email" }
    operator: eq
    expected: { kind: variable, name: email }
  - id: 0192...a3
    enabled: true
    actual: { kind: dbCheck, check: userRow, path: "rows[0].id" }
    operator: eq
    expected: { kind: jsonBody, path: "$.id" }
  - id: 0192...a4
    enabled: true
    actual: { kind: responseTime }
    operator: lt
    expected: { kind: literal, value: 500 }
```

### Варіанти `body`
```yaml
body: { type: none }
body: { type: json | xml | text, raw: "..." }
body: { type: formUrlEncoded, fields: [ { key, value, enabled } ] }
body: { type: multipart, fields: [ { key, kind: text|file, value, filePath, contentType, enabled } ] }
body: { type: binary, filePath: ./fixtures/avatar.png }   # шлях відносно файлу запиту або workspace
```

### Варіанти `auth`
```yaml
auth: { type: inherit }
auth: { type: none }
auth: { type: basic, username: "{{user}}", password: "{{pass}}" }
auth: { type: bearer, token: "{{token}}" }
auth: { type: apiKey, key: X-Api-Key, value: "{{apiKey}}", in: header }   # header | query
```

## 3.6 Request (SOAP)

```yaml
id: 0192...c9
type: soap
name: Get invoice
order: 0
url: "{{billingUrl}}/InvoiceService.svc"
soap:
  version: "1.1"                     # "1.1" | "1.2"
  action: "http://tempuri.org/IInvoiceService/GetInvoice"
  operation: GetInvoice
  wsdl:
    source: "{{billingUrl}}/InvoiceService.svc?wsdl"   # або шлях до файлу
    service: InvoiceService
    port: BasicHttpBinding_IInvoiceService
  namespaces:                        # префікси для XPath-асертів
    s: http://schemas.xmlsoap.org/soap/envelope/
    t: http://tempuri.org/
headers: []
auth: { type: inherit }
envelope: |
  <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
    <s:Body>
      <GetInvoice xmlns="http://tempuri.org/">
        <invoiceId>{{invoiceId}}</invoiceId>
      </GetInvoice>
    </s:Body>
  </s:Envelope>
extract: []
dbChecks: []
assertions:
  - id: 0192...x1
    enabled: true
    actual: { kind: xmlBody, xpath: "//t:GetInvoiceResult/t:Total/text()" }
    operator: eq
    expected: { kind: literal, value: "100.00" }
```

`Content-Type` і `SOAPAction` генеруються рантаймом з `soap.version`/`soap.action`, якщо користувач не перевизначив їх у `headers`.

## 3.7 Environment

`environments/dev.env.yaml`:
```yaml
schemaVersion: 1
id: 0192...f1
name: dev
color: green                 # візуальна мітка в TopBar (red для prod — захист від помилок)
variables:
  - { key: baseUrl, value: "https://dev.api.example.com", enabled: true }
  - { key: apiKey, type: secret, secretRef: "env/0192...f1/apiKey", enabled: true }
  - { key: dbHost, value: "dev-db.internal", enabled: true }
```

`_globals.yaml` — та ж схема з `name: Globals`.

`.apipulse/local.env.yaml` (не в Git) — перевизначення per-environment:
```yaml
overrides:
  dev:
    - { key: baseUrl, value: "http://localhost:8080" }
```

## 3.8 DB connection profile

`databases/pg-dev.db.yaml`:
```yaml
schemaVersion: 1
id: 0192...c1
name: pg-dev
driver: postgres              # postgres | mysql | mssql | cosmos | sqlite
host: "{{dbHost}}"
port: 5432
database: users
username: app_reader
password:
  mode: keychain              # keychain | prompt | variable
  secretRef: "db/0192...c1/password"
  # variable: dbPassword      # для mode: variable
ssl:
  mode: prefer                # disable | prefer | require | verify-ca | verify-full
  caFile: null
protected: false              # true → заборона setup-кроків і запису в SQL Runner
options:
  connectTimeoutMs: 5000
  statementTimeoutMs: 30000
  extra: { application_name: api-pulse }
```

MS SQL Server:
```yaml
schemaVersion: 1
id: 0192...c3
name: mssql-billing
driver: mssql
host: "{{billingDbHost}}"
port: 1433
instance: null                # для named instance (SQL Browser, UDP 1434)
database: Billing
auth: sql                     # sql | windows
username: qa_user
password: { mode: keychain, secretRef: "db/0192...c3/password" }
tls: { encrypt: "on", trustServerCertificate: false }   # on | off | strict
protected: false
options: { connectTimeoutMs: 5000, statementTimeoutMs: 30000, applicationIntent: ReadWrite }
```

Azure Cosmos DB (NoSQL API):
```yaml
schemaVersion: 1
id: 0192...c4
name: cosmos-events
driver: cosmos
endpoint: "https://{{cosmosAccount}}.documents.azure.com:443/"
database: events
auth:
  mode: key                   # key | entra
  secretRef: "db/0192...c4/key"   # для mode: key (рекомендовано read-only key)
  # tenantId: "..."           # для mode: entra (Azure CLI / DefaultAzureCredential)
emulator: false               # true → довіряти self-signed сертифікату емулятора
protected: false
```

SQLite:
```yaml
schemaVersion: 1
id: 0192...c2
name: local-sqlite
driver: sqlite
file: ./data/app.db           # відносно workspace або абсолютний
readOnly: true
```

**Порада**: профілі БД зберігаються у workspace (спільні для команди), але `host`/`database` краще параметризувати змінними оточення.

## 3.9 Секрети
- Сховище: OS Keychain (Windows Credential Manager, macOS Keychain, Secret Service/libsecret на Linux).
- `service = "api-pulse"`, `account = "<workspaceId>/<secretRef>"`.
- Fallback, якщо Keychain недоступний (Linux без Secret Service): зберігати в `.apipulse/secrets.json` з попередженням у UI (файл у `.gitignore`). Шифрування майстер-паролем — post-MVP.
- При клонуванні репо без секретів — змінні з `secretRef` без значення підсвічуються жовтим «Secret not set on this machine».

## 3.10 Історія (`history/<workspaceId>.jsonl`)

Один рядок — одне виконання:
```json
{"id":"0192...","ts":"2026-10-18T12:41:03.120Z","requestId":"0192...b7","name":"Create user","method":"POST","url":"https://dev.api.example.com/v2/users","status":201,"totalMs":182,"envId":"0192...f1","tests":{"passed":4,"failed":1},"snapshotFile":"snapshots/0192....json"}
```
Snapshot (запит після резолву + відповідь, тіло обрізане до 1 MB, секрети замасковані) — окремим файлом. Ротація за кількістю записів із Settings.

## 3.11 Налаштування додатка (`settings.json`)
```json
{
  "schemaVersion": 1,
  "theme": "system",
  "language": "uk",
  "layout": { "responsePosition": "bottom" },
  "editor": { "fontSize": 13, "wordWrap": true },
  "request": { "timeoutMs": 30000, "followRedirects": true, "maxRedirects": 10, "verifyTls": true, "maxDisplayBytes": 10485760, "userAgent": "API-Pulse/0.1" },
  "proxy": { "mode": "system", "url": null, "bypass": ["localhost", "127.0.0.1"] },
  "history": { "maxEntries": 200, "storeBodies": true },
  "restoreTabs": true
}
```

## 3.12 JSON Schema

Схеми генеруються з Rust-типів (`schemars`) у `schemas/*.schema.json` і публікуються в репо — це дає валідацію та автодоповнення у VS Code для ручного редагування YAML (`# yaml-language-server: $schema=...`). Ключова частина (Request):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://api-pulse.dev/schemas/request.schema.json",
  "type": "object",
  "required": ["id", "type", "name"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "enum": ["http", "soap"] },
    "name": { "type": "string", "minLength": 1 },
    "order": { "type": "integer" },
    "method": { "type": "string", "pattern": "^[A-Z]+$" },
    "url": { "type": "string" },
    "headers": { "type": "array", "items": { "$ref": "#/$defs/kv" } },
    "extract": { "type": "array", "items": { "$ref": "#/$defs/extractor" } },
    "dbChecks": { "type": "array", "items": { "$ref": "#/$defs/dbCheck" } },
    "assertions": { "type": "array", "items": { "$ref": "#/$defs/assertion" } }
  },
  "allOf": [
    { "if": { "properties": { "type": { "const": "http" } } }, "then": { "required": ["method", "url"] } },
    { "if": { "properties": { "type": { "const": "soap" } } }, "then": { "required": ["url", "soap", "envelope"] } }
  ],
  "$defs": {
    "kv": {
      "type": "object", "required": ["key"],
      "properties": { "key": { "type": "string" }, "value": { "type": "string" }, "enabled": { "type": "boolean", "default": true }, "description": { "type": "string" } }
    },
    "valueRef": {
      "oneOf": [
        { "type": "object", "required": ["kind", "value"], "properties": { "kind": { "const": "literal" }, "value": {} } },
        { "type": "object", "required": ["kind", "name"], "properties": { "kind": { "const": "variable" }, "name": { "type": "string" } } },
        { "type": "object", "required": ["kind"], "properties": { "kind": { "enum": ["status", "responseTime", "bodyText", "bodySize"] } } },
        { "type": "object", "required": ["kind", "name"], "properties": { "kind": { "const": "header" }, "name": { "type": "string" } } },
        { "type": "object", "required": ["kind", "path"], "properties": { "kind": { "const": "jsonBody" }, "path": { "type": "string" } } },
        { "type": "object", "required": ["kind", "xpath"], "properties": { "kind": { "const": "xmlBody" }, "xpath": { "type": "string" } } },
        { "type": "object", "required": ["kind", "pattern"], "properties": { "kind": { "const": "regex" }, "pattern": { "type": "string" }, "group": { "type": "integer", "default": 1 } } },
        { "type": "object", "required": ["kind", "check"], "properties": { "kind": { "const": "dbCheck" }, "check": { "type": "string" }, "path": { "type": "string", "default": "rowCount" } } }
      ]
    },
    "extractor": {
      "type": "object", "required": ["id", "variable", "source"],
      "properties": { "id": { "type": "string" }, "enabled": { "type": "boolean" }, "variable": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_.-]*$" }, "scope": { "enum": ["runtime", "environment", "global"] }, "source": { "$ref": "#/$defs/valueRef" } }
    },
    "dbCheck": {
      "type": "object", "required": ["id", "name", "connectionId", "sql"],
      "properties": {
        "id": { "type": "string" }, "enabled": { "type": "boolean" },
        "name": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*$" },
        "connectionId": { "type": "string" }, "sql": { "type": "string" },
        "params": { "type": "array", "items": { "type": "object", "required": ["name", "value"], "properties": { "name": { "type": "string" }, "value": { "type": "string" }, "type": { "enum": ["auto", "string", "int", "float", "bool", "null", "uuid", "timestamp", "json"] } } } },
        "waitBeforeMs": { "type": "integer", "minimum": 0 },
        "retry": { "type": "object", "properties": { "attempts": { "type": "integer", "minimum": 1, "maximum": 50 }, "intervalMs": { "type": "integer", "minimum": 0 } } },
        "maxRows": { "type": "integer", "minimum": 1, "default": 100 }
      }
    },
    "assertion": {
      "type": "object", "required": ["id", "actual", "operator"],
      "properties": {
        "id": { "type": "string" }, "enabled": { "type": "boolean" },
        "actual": { "$ref": "#/$defs/valueRef" },
        "operator": { "enum": ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "startsWith", "endsWith", "matches", "exists", "notExists", "isEmpty", "isNotEmpty", "isNull", "isNotNull", "isType", "in", "notIn", "lengthEq", "lengthGt", "lengthLt", "deepEq", "eqIgnoreCase"] },
        "expected": { "$ref": "#/$defs/valueRef" },
        "options": { "type": "object", "properties": { "numericTolerance": { "type": "number" }, "trim": { "type": "boolean" }, "ignoreOrder": { "type": "boolean" } } }
      }
    }
  }
}
```

## 3.13 Імпорт / Експорт

| Формат | Напрям | MVP | Деталі |
|--------|--------|-----|--------|
| **API-Pulse bundle** (`*.apipulse.json` / `.yaml`) | ⇄ | ✔ | Одна колекція або весь workspace одним файлом: `{ schemaVersion, kind: "bundle", collections: [ {…, children: [...] } ], environments, databases }`. Секрети не експортуються (лише `secretRef`); опція «Include secret values» з явним попередженням — post-MVP |
| Postman Collection v2.1 | ⇦ | ✔ | Запити, папки, змінні, auth (basic/bearer/apikey). Скрипти `pm.*` не конвертуються → у `ImportReport.warnings` |
| Postman Environment | ⇦ | ✔ | |
| WSDL 1.1 | ⇦ | ✔ | Див. 02-ux-ui.md §2.4 |
| cURL | ⇦ / ⇨ | ✔ | Вставка в UrlBar; «Copy as cURL» з контекстного меню |
| OpenAPI 3.x | ⇦ | post-MVP | |
| SoapUI project XML | ⇦ | ✔ (Should) | Інтерфейси/операції → колекції; TestSuite/TestCase → Suite/Scenario; TestStep `request` → Request step, `jdbc` → SQL step, `delay` → Delay, `properties`/`transfer` → Set Variables / Extract. Асерти: Contains, Not Contains, XPath Match, Valid HTTP Status Codes, SOAP Fault, Schema Compliance, Response SLA → нативні. Groovy-скрипти → переносяться як disabled-крок з текстом і warning |
| Bruno `.bru` | ⇦ | post-MVP | |

`ImportReport = { created: { collections, folders, requests }, warnings: string[], errors: string[] }` — показується в діалозі після імпорту.

## 3.14 Міграції схем
- `schemaVersion` у кожному кореневому файлі; `storage/migrate.rs` має ланцюжок `v1→v2→…` на рівні `serde_yaml::Value`.
- Перед міграцією — копія файлу в `.apipulse/backup/<timestamp>/`.
- Файл з `schemaVersion` новішою за підтримувану — відкривається read-only з банером «Created by newer version».

## 3.15 Чому YAML і правила запису

| Критерій | JSON | YAML | TOML | Власний DSL (Bruno `.bru`) | XML (SoapUI) |
|----------|------|------|------|-----------------------------|--------------|
| Багаторядковий SQL / XML / JSON body | ✘ один рядок з `\n` і `\"` | ✔ `\|` block scalar | ± `"""` | ✔ | ± CDATA |
| Читабельний git-diff | ± | ✔ | ✔ | ✔ | ✘ |
| Коментарі | ✘ | ✔ | ✔ | ✔ | ✔ |
| Глибока вкладеність (кроки → асерти → ValueRef) | ✔ | ✔ | ✘ громіздко | ± | ✔ |
| JSON Schema для автодоповнення у VS Code | ✔ | ✔ | ± | ✘ | ± XSD |
| Готові парсери в усіх мовах | ✔ | ✔ | ✔ | ✘ свій парсер | ✔ |
| Пастки | — | неявні типи (`no` → false, `010` → 8), відступи | — | підтримка свого формату | мердж-конфлікти |

Вибір YAML визначає перший рядок: у цьому інструменті половина вмісту — багаторядкові SQL, SOAP-конверти і JSON-тіла. Пастки YAML нейтралізуються тим, що **файли пише програма за фіксованими правилами**:

1. Усі рядкові значення, що можуть бути неоднозначними (`yes`, `no`, `on`, `null`, числа, дати, починаються з `{`, `*`, `&`, `!`, `@`, `%`), завжди в лапках.
2. Багаторядкові значення — завжди literal block `|` (або `|-` без фінального `\n`), табуляції → пробіли не змінюються.
3. Відступ 2 пробіли, фіксований порядок ключів, без anchors/aliases/tags.
4. Читання — YAML 1.2 Core schema (без `yes/no` як bool), сувора валідація за JSON Schema, помилка з номером рядка.
5. Rust-бібліотека: `serde_yaml` архівований → читання через `serde_yaml_ng` (або `saphyr`), запис — власний емітер (~300 рядків) для детермінованого виводу за правилами 1–3.
6. Великі фікстури (SQL-сиди, еталонні відповіді) — окремими файлами `.sql` / `.json` / `.xml` з посиланням `file: ./fixtures/...`.

Архітектура не прив'язана до YAML: шар `storage` працює з Rust-моделлю, формат — деталь серіалізатора. Експорт/імпорт JSON підтримується завжди.
