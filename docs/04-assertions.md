# 04. Змінні, екстракція, DB Checks та асерти (Крок 3)

## 4.1 Конвеєр виконання запиту (`runner::pipeline`)

```mermaid
sequenceDiagram
    participant UI
    participant R as Runner (Rust)
    participant H as HTTP
    participant D as DB
    UI->>R: run_request(execId, request, envId)
    R->>R: 1. Зібрати scope змінних
    R->>R: 2. Резолв {{vars}} в URL/headers/auth/body
    R->>H: 3. Відправити запит
    H-->>R: HttpResponse
    R->>R: 4. Extractors → runtime vars
    loop для кожного DB Check (по порядку)
        R->>R: 5a. wait waitBeforeMs
        R->>D: 5b. SQL з bind-параметрами
        D-->>R: QueryResult
        R->>R: 5c. Асерти, що залежать від check; якщо FAIL і є retry → повтор
    end
    R->>R: 6. Решта асертів
    R-->>UI: RunResult
    R->>R: 7. Запис в історію
```

Правила:
- Помилка на кроці 2 (невизначена змінна) — **не блокує** відправку за замовчуванням: залишається `{{name}}` буквально + warning у результаті. Налаштування `strictVariables: true` (у колекції) — блокує.
- Помилка мережі на кроці 3 → кроки 4–6 пропускаються, всі асерти отримують статус `SKIPPED` (крім тих, що не залежать від відповіді — таких немає в MVP).
- Помилка DB Check (з'єднання/SQL) → check `ERROR`, асерти, що на нього посилаються, — `ERROR`; інші виконуються.
- **Retry DB Check**: повтор виконання check, доки всі асерти, що посилаються на цей check, не стануть PASSED, або не вичерпано `attempts`. Покриває асинхронні системи (черги, eventual consistency).
- Скасування (`Esc`) перериває будь-який крок; результат `CANCELLED`.

## 4.2 Змінні

### 4.2.1 Синтаксис
- `{{name}}` — змінна; ім'я `[A-Za-z_][A-Za-z0-9_.-]*`.
- `{{$dynamic}}` / `{{$dynamic(arg)}}` — динамічні значення.
- Екранування: `\{{literal}}` → `{{literal}}` без підстановки.
- Підстановка рекурсивна (значення змінної може містити `{{...}}`), глибина ≤ 10, цикли → помилка `VALIDATION: circular variable reference a → b → a`.

### 4.2.2 Пріоритет (вищий перемагає)
1. **Runtime** — записані екстракторами в поточній сесії (`.apipulse/runtime-vars.json`).
2. **Local overrides** — `.apipulse/local.env.yaml` для активного оточення.
3. **Request-level** — (post-MVP, в MVP немає).
4. **Folder** → **Collection** (найближчий предок вище).
5. **Environment** (активне).
6. **Globals**.

UI-popover 👁 показує ефективне значення і джерело кожної змінної. Кнопка «Clear runtime variables».

### 4.2.3 Динамічні змінні (MVP)
| Змінна | Результат |
|--------|-----------|
| `{{$uuid}}` | UUID v4 |
| `{{$timestamp}}` | Unix seconds |
| `{{$timestampMs}}` | Unix milliseconds |
| `{{$isoDate}}` | `2026-10-18T12:41:03.120Z` |
| `{{$randomInt(min,max)}}` | ціле, за замовчуванням 0..1000 |
| `{{$randomString(len)}}` | `[a-zA-Z0-9]`, за замовчуванням 10 |
| `{{$randomEmail}}` | `user_<random>@example.test` |
| `{{$env(NAME)}}` | змінна ОС (корисно в CI) |

Динамічна змінна обчислюється **один раз на виконання** для однакового виразу (щоб `{{$uuid}}` в тілі й заголовку збігалися). Для різних значень — `{{$uuid#1}}`, `{{$uuid#2}}`.

### 4.2.4 Типи значень
Змінні зберігають JSON-значення (`string | number | boolean | null | object | array`). При підстановці в текст: string — як є, інші — `serde_json::to_string`. Це дозволяє в JSON-тілі писати `"id": {{userId}}` (число без лапок) і `"tags": {{tags}}` (масив).

## 4.3 Екстрактори (Extract)

| Source | Параметри | Приклад | Результат |
|--------|-----------|---------|-----------|
| `jsonBody` | JSONPath (RFC 9535) | `$.data.items[0].id` | Перший збіг; якщо `extractAll: true` — масив усіх збігів |
| `xmlBody` | XPath 1.0 + namespaces | `//t:InvoiceId/text()` | рядок / число (`number(...)`) / bool |
| `header` | ім'я (case-insensitive) | `Location` | рядок (перше значення) |
| `cookie` | ім'я | `SESSIONID` | рядок |
| `regex` | pattern, group | `id=(\d+)` group 1 | рядок |
| `status` | — | | число |
| `dbCheck` | check, path | `userRow` / `rows[0].email` | значення клітинки (екстрактор над DB виконується після checks) |

- `scope`: `runtime` (за замовчуванням), `environment` (записує в активне оточення — у файл, з підтвердженням при першому разі), `global`.
- Якщо шлях нічого не знайшов → змінна **не змінюється**, у Tests — `✘ extract userId: path $.id not found` (статус FAILED, рахується в загальний підсумок).
- Порядок: екстрактори з API-джерелами виконуються **до** DB Checks (щоб `:userId` в SQL отримав значення), екстрактори з `dbCheck` — після.

## 4.4 DB Checks

### 4.4.1 Параметри SQL
- Іменовані параметри в SQL: `:name` (не всередині рядкових літералів, коментарів і `::cast` у Postgres).
- Runner перетворює їх у нативні плейсхолдери драйвера: Postgres `$1, $2`, MySQL/SQLite `?`. Порядок біндингу — за входженням; повторне `:name` → у Postgres той самий `$n`, у MySQL/SQLite — дублювання значення.
- Значення параметра — шаблон (`{{userId}}`, `{{$uuid}}`) або посилання на відповідь `API: $.id` (зберігається як `{ kind: jsonBody, path }`).
- `type: auto` визначає тип із JSON-значення: number → int/float, bool → bool, null → NULL, string → text. Явний `type` (`uuid`, `timestamp`, `json`) — коли колонка не text (Postgres суворо типізований: `WHERE id = $1` з text для `uuid` колонки впаде — тоді або `type: uuid`, або `:userId::uuid` у SQL).
- **Заборонено** підставляти `{{var}}` безпосередньо в текст SQL у DB Checks — UI показує помилку валідації «Use :param instead of {{var}} inside SQL» (ADR-07). У SQL Runner (ручний режим) `{{var}}` дозволені з попередженням.

### 4.4.2 Режим виконання
- Кожен check — окремо, в режимі readOnly профілю; автокоміт.
- `maxRows` (100) — щоб не тягнути великі таблиці.
- `statementTimeoutMs` з профілю.
- Результат зберігається в контексті як:
```json
{
  "userRow": {
    "rowCount": 1,
    "columns": ["id", "email", "status"],
    "rows": [ { "id": 42, "email": "a@b.com", "status": "active" } ],
    "elapsedMs": 8,
    "attempt": 1
  }
}
```

### 4.4.3 Шляхи доступу до результату (`path` для `kind: dbCheck`)
| Path | Значення |
|------|----------|
| `rowCount` (за замовчуванням) | кількість рядків |
| `rows[0].email` | клітинка |
| `rows[*].email` | масив значень колонки |
| `rows[0]` | об'єкт рядка |
| `rows` | масив об'єктів |
| `$.rows[?(@.status=='active')].id` | будь-який JSONPath поверх об'єкта результату (якщо починається з `$`) |

Внутрішньо простий синтаксис конвертується в JSONPath: `rows[0].email` → `$.rows[0].email`. Один механізм для API і DB.

Імена колонок зіставляються **без урахування регістру** (`rows[0].HOST` == `rows[0].Host`) — SoapUI віддає JDBC-колонки у верхньому регістрі, і імпортовані шляхи мають працювати без змін. Для MSSQL-батчів з кількома result set: `results[1].rows[0].col` (за замовчуванням `rows` = останній result set, що повернув рядки).

## 4.5 Асерти

### 4.5.1 Модель
```
Assertion = actual: ValueRef  operator  expected?: ValueRef  options?
```
`ValueRef` однаковий для обох сторін (див. 03-data-model §3.12), тому будь-яке джерело можна порівняти з будь-яким: API ↔ literal, API ↔ DB, DB ↔ variable, header ↔ regex.

### 4.5.2 Оператори

| Operator | UI-назва | Типи | Expected | Семантика |
|----------|----------|------|----------|-----------|
| `eq` / `neq` | equals / not equals | будь-які скаляри | ✔ | з приведенням типів (§4.5.3) |
| `eqIgnoreCase` | equals (ignore case) | string | ✔ | |
| `deepEq` | deep equals | object/array | ✔ | структурне порівняння; `options.ignoreOrder` для масивів |
| `gt` `gte` `lt` `lte` | > ≥ < ≤ | number, date | ✔ | числа або ISO-дати |
| `contains` / `notContains` | contains | string, array | ✔ | підрядок / елемент масиву |
| `startsWith` / `endsWith` | | string | ✔ | |
| `matches` | matches regex | string | ✔ (pattern) | `regex` crate, повний або частковий збіг (`^…$` вказує користувач) |
| `in` / `notIn` | is one of | скаляр | ✔ (масив або CSV) | |
| `exists` / `notExists` | exists | будь-які | — | шлях знайдено (навіть якщо значення `null`) |
| `isNull` / `isNotNull` | is null | | — | |
| `isEmpty` / `isNotEmpty` | is empty | string/array/object | — | `""`, `[]`, `{}`, `rowCount == 0` |
| `isType` | is type | будь-які | ✔ (`string`/`number`/`boolean`/`object`/`array`/`null`) | |
| `lengthEq` `lengthGt` `lengthLt` | length = / > / < | string/array | ✔ number | |

UI фільтрує оператори за типом `actual` з останнього виконання (якщо невідомо — показує всі).

Пресети для джерел:
- `status` → оператори `eq`, `neq`, `in`, `gte`, `lt` + швидкі чіпи `2xx`, `4xx` (перетворюються в `gte 200` + `lt 300`, тобто два асерти, або один `in [200..299]`).
- `responseTime` → `lt`, `lte` (мс).
- `header` → `exists`, `eq`, `contains`, `matches`.

### 4.5.3 Правила порівняння та приведення типів
Головне джерело проблем у порівнянні API ↔ DB: БД повертає `decimal` як рядок, `bigint` — як рядок/число, дати — у різних форматах, JSON API — числа й ISO-рядки. Тому:

1. **Число vs рядок**: якщо одна сторона число, а інша — рядок, що парситься як число (`"42"`, `"100.00"`), порівнюються як **десяткові числа** (`rust_decimal`, без втрати точності): `100.00 == 100` → true.
2. **Bool vs рядок/число**: `true` ≡ `"true"` ≡ `1` ≡ `"t"` (Postgres) ; `false` ≡ `"false"` ≡ `0` ≡ `"f"`.
3. **Дати**: якщо обидві сторони парсяться як дата/час (ISO 8601, RFC 3339, `YYYY-MM-DD HH:MM:SS[.fff]`), порівнюються як моменти часу в UTC. Без зони → вважається UTC (налаштування колекції `naiveTimezone`). Опція `options.dateTolerance` (мс) для різниці точності (БД — мікросекунди, API — мілісекунди).
4. **UUID**: порівняння без урахування регістру.
5. **null**: `null == null` → true; `null` vs `"null"` → false; відсутній шлях ≠ `null` (для цього `exists`).
6. **Рядки**: точне порівняння; `options.trim: true` — обрізати пробіли (часто `CHAR(n)` у БД).
7. **Числа з плаваючою крапкою**: `options.numericTolerance` (наприклад `0.001`).
8. **Масиви/об'єкти** в `eq` → помилка конфігурації з підказкою використати `deepEq`.
9. Якщо JSONPath повернув кілька значень, а оператор скалярний → використовується **перше**, у результаті — warning «path returned N values, compared first». Для перевірки всіх — `rows[*].x` + `contains` / `deepEq`.

Модуль `runner/compare.rs` — чиста функція `compare(actual: &Value, op, expected: &Value, opts) -> Outcome`, покривається табличними unit-тестами (≥ 100 кейсів).

### 4.5.4 Результат

```ts
type RunResult = {
  execId: string;
  status: 'PASSED' | 'FAILED' | 'ERROR' | 'CANCELLED';   // агрегований
  request: ResolvedRequestSnapshot;                     // з маскуванням секретів
  response?: HttpResponse;
  error?: AppError;
  warnings: string[];
  extracts: { id: string; variable: string; status: Outcome; value?: unknown; message?: string }[];
  dbChecks: { id: string; name: string; status: Outcome; attempts: number; result?: QueryResult; error?: AppError }[];
  assertions: { id: string; status: Outcome; actual?: unknown; expected?: unknown; message: string; durationMs: number }[];
  summary: { passed: number; failed: number; errors: number; skipped: number };
  totalMs: number;
};
type Outcome = 'PASSED' | 'FAILED' | 'ERROR' | 'SKIPPED';
```

`message` формується людиночитно: `DB userRow.rows[0].status equals "active" — expected "active", got "pending"`.

## 4.6 UI-взаємодія No-Code (сценарії)

**Сценарій A — «Створив користувача → перевірив у БД»**
1. Тестувальник надсилає `POST /users`, отримує `{ "id": 42, "email": "a@b.com" }`.
2. ПКМ на `42` у Pretty JSON → «Extract to variable…» → ім'я `userId` → створюється екстрактор `$.id`.
3. «Checks & Asserts» → `+ Add check` → вибирає `pg-dev` → пише `SELECT * FROM users WHERE id = :userId` → параметр `userId` автоматично заповнюється `{{userId}}`.
4. `▶ Run` на картці → бачить рядок → клік по клітинці `status` → «Assert equals this value» → створюється асерт `DB userRow.rows[0].status eq "active"`.
5. ПКМ на `email` у відповіді API → «Compare with DB…» → вибір `userRow.email` → асерт `API $.email eq DB userRow.rows[0].email`.
6. `Send` → вкладка Tests: 4/4 ✔.

**Сценарій B — «Видалив → переконався, що рядка немає»**
`DELETE /users/{{userId}}` → DB Check `SELECT 1 FROM users WHERE id = :userId` → асерт `DB check.rowCount eq 0`, `retry 5 × 300ms`.

**Сценарій C — SOAP**
Відповідь `GetInvoice` → ПКМ на `<Total>100.00</Total>` → «Compare with DB…» → `invoiceRow.rows[0].total` (decimal) → асерт проходить завдяки числовому приведенню.

## 4.7 Текстовий режим асертів

Альтернативне представлення тих самих даних (двосторонній синк з YAML-моделлю). Один рядок — один асерт:

```
status == 201
time < 500
header["Content-Type"] contains "application/json"
json $.email == {{email}}
json $.items length > 0
xml //t:Total/text() == "100.00"
db userRow.rowCount == 1
db userRow.rows[0].id == json $.id
db userRow.rows[0].status in ["active", "pending"]
db userRow.rows[0].created_at exists
# disabled: json $.debug notExists
```

Граматика (EBNF, спрощено):
```
line      = [ "#" ] assertion | comment ;
assertion = operand ws op [ ws operand ] [ ws options ] ;
operand   = "status" | "time" | "size"
          | "header[" string "]" | "cookie[" string "]"
          | "json" ws jsonpath | "xml" ws xpath | "regex" ws string [ "#" int ]
          | "db" ws ident "." dbpath
          | "{{" ident "}}" | literal ;
op        = "==" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "!contains"
          | "startsWith" | "endsWith" | "matches" | "in" | "!in"
          | "exists" | "!exists" | "isNull" | "!isNull" | "isEmpty" | "!isEmpty"
          | "isType" | "length ==" | "length >" | "length <" | "deepEquals" | "~=" (* eqIgnoreCase *) ;
literal   = json-value ;
options   = "{" key ":" value { "," key ":" value } "}" ;  (* {trim:true, tolerance:0.01} *)
```
Парсер — у Rust (`nom` або `winnow`), відкритий як команда `assertions_parse` / `assertions_format` для UI. Ідентифікатори (`id`) рядків зберігаються при синку за позицією+змістом.

## 4.8 Тестова матриця двигуна (мінімум)

| Область | Кейси |
|---------|-------|
| Resolver | пріоритети 6 рівнів, рекурсія, цикл, невизначена змінна (strict/non-strict), escape, типи (число/масив у JSON body), динамічні змінні та їх стабільність у межах виконання |
| Extract | JSONPath: вкладені, фільтри, масиви, не знайдено; XPath з namespaces; regex групи; header case-insensitive |
| SQL params | `:name` у рядку/коментарі/`::cast` ігнорується; повтор параметра; Postgres `$n`, MySQL `?`; типи uuid/timestamp/json; NULL |
| Compare | число↔рядок, decimal точність, bigint > 2^53, bool-варіанти, дати з/без TZ та tolerance, uuid регістр, null vs missing, CHAR trim |
| Retry | успіх на 3-й спробі; вичерпання спроб; скасування під час очікування |
| Pipeline | мережева помилка → SKIPPED; помилка БД → ERROR лише залежних; скасування на кожному кроці |
| Інтеграція | testcontainers Postgres 16, MySQL 8, MariaDB 11, MS SQL Server 2022, Cosmos DB Emulator (Linux), SQLite in-memory + wiremock API |

## 4.9 Додаткові типи перевірок (крім «значення оператор значення»)

| Тип | Для | Конфігурація | Семантика |
|-----|-----|--------------|-----------|
| `jsonSchema` | REST | inline-схема або `file: ./schemas/user.json` | Валідація тіла (`jsonschema`, draft 2020-12/07); у звіті — список порушень з JSON Pointer |
| `xsdCompliance` | SOAP | авто з WSDL запиту або `file: *.xsd` | Відповідь (вміст `soap:Body`) відповідає XSD-типу вихідного повідомлення операції (аналог SoapUI Schema Compliance) |
| `soapFault` / `notSoapFault` | SOAP | опційно очікуваний `faultcode` / regex для `faultstring` | |
| `bodyMatchesSnapshot` | REST/SOAP | файл-еталон + список ігнорованих шляхів (`$.id`, `$.createdAt`, `//t:Timestamp`) | Структурне порівняння; кнопка «Update snapshot» з поточної відповіді |
| `rowMatchesObject` | API ↔ DB | `api: $.data` (об'єкт або масив) ↔ `db: userRow` + таблиця мапінгу `apiPath ↔ column` (авто-мапінг за однаковими іменами, `camelCase ↔ snake_case`) | Один асерт замість N; у звіті — таблиця полів ✔/✘. Для масивів: ключ зіставлення (`id`), опція `ignoreOrder`, перевірка кількості |
| `countMatches` | API ↔ DB | `api: $.items` ↔ `db: listCheck` | `len(api) == rowCount` |

```yaml
assertions:
  - id: 0192...m1
    type: rowMatchesObject
    api: { kind: jsonBody, path: "$" }
    db: { check: userRow, row: 0 }
    mapping:
      auto: snakeCase
      fields:
        - { api: "$.fullName", column: name }
        - { api: "$.id", column: id, compare: { trim: true } }
      ignore: [ "$.links" ]
```

Оператори з §4.5 залишаються базовими; ці типи — окремі `type` в моделі (`type: value` за замовчуванням для простих асертів).

## 4.10 Перевірки в Azure Cosmos DB

DB Check для профілю `cosmos` використовує Cosmos SQL з нативними параметрами `@name`:

```yaml
dbChecks:
  - id: 0192...g1
    name: orderDoc
    connectionId: 0192...c4
    cosmos:
      container: orders
      partitionKey: "{{operatorId}}"   # опційно; без нього — cross-partition query
      query: |
        SELECT c.id, c.status, c.items, c.total
        FROM c
        WHERE c.orderId = @orderId
    params:
      - { name: orderId, value: "{{orderId}}" }
    retry: { attempts: 10, intervalMs: 1000 }
```

- Параметри передаються як типізовані JSON-значення (`parameters: [{ name: "@orderId", value: ... }]`), тому ін'єкція через значення неможлива. `{{var}}` всередині тексту query — помилка валідації (як для SQL).
- Point read (`operation: read`, `id` + `partitionKey`) — найдешевша перевірка за RU; результат 404 → `rowCount = 0` (а не помилка), щоб можна було перевіряти «документ видалено».
- Setup-операції (`mode: setup`): `upsert` (документ — JSON-шаблон з типізованою підстановкою `"{{var}}"`), `delete` (id + PK). Cleanup для upsert генерується автоматично (delete того ж id/PK).
- Cosmos — eventual consistency для багатьох систем (change feed, функції, черги) → retry тут потрібен частіше, ніж для SQL.
- Результат — `rows` = документи, тому асерти однакові: `orderDoc.rows[0].status`, `orderDoc.rowCount`, `orderDoc.rows[0].items[*].sku`.
- `requestCharge` (RU) доступний як `orderDoc.requestCharge` — можна асертити вартість запиту.
