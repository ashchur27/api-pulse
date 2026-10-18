# 02. UX/UI специфікація (Крок 1)

## 2.1 Принципи

1. **Один екран — одна задача**: запит зліва-направо «налаштував → відправив → побачив результат і тести».
2. **Клавіатура першочергово**: усі основні дії мають шорткати.
3. **No-Code за замовчуванням, Code — опційно**: асерти будуються формою; для досвідчених — текстовий режим.
4. **Ніколи не губити дані**: автозбереження чернетки вкладки, індикатор незбережених змін, підтвердження при закритті.
5. Доступність: контраст WCAG AA в обох темах, фокус-кільця, `aria-label` на іконкових кнопках (shadcn/Radix дає базу).

## 2.2 Головний макет (AppShell)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡] API-Pulse   Workspace: my-project ▾          Env: [ dev ▾ ] [👁]   [⚙] [◐] │  TopBar
├────┬─────────────────────┬───────────────────────────────────────────────────┤
│ C  │ Collections   [+][⇩]│ [GET Users ●] [POST Create user] [SQL: pg-dev] [+] │  TabBar
│ E  │ 🔍 filter…          ├───────────────────────────────────────────────────┤
│ D  │ ▾ Users API          │ [POST ▾] {{baseUrl}}/users              [ Send ▸ ] │  UrlBar
│ H  │   ▾ Users            ├───────────────────────────────────────────────────┤
│    │     GET  List        │ Params | Headers(3) | Auth | Body | Extract(1) |  │
│    │     POST Create  ●   │ Checks & Asserts(4) | Settings                     │  Request
│    │   ▸ Orders           │  ...редактор активної вкладки...                   │  Panel
│    │ ▸ Billing SOAP       ├════════════════ resizable ════════════════════════┤
│    │                      │ 201 Created · 182 ms · 1.2 KB      Tests: 4/5 ✔  │
│    │                      │ Body | Headers(9) | Cookies | Timeline | Tests    │  Response
│    │                      │  { "id": 42, ... }                                 │  Panel
├────┴─────────────────────┴───────────────────────────────────────────────────┤
│ ● pg-dev connected · Last run 12:41:03 · 3 req in history                     │  StatusBar
└──────────────────────────────────────────────────────────────────────────────┘
```

- **ActivityBar** (вузька ліва смуга): `C` Collections, `S` Scenarios (див. [06-scenarios.md](06-scenarios.md)), `E` Environments, `D` Databases, `H` History. Перемикає вміст Sidebar.
- **Sidebar**: ширина змінна (200–480 px), згортається `Ctrl+B`.
- **Request/Response** розділені горизонтально; перемикач на вертикальне розміщення у Settings (для широких екранів).
- Мінімальний розмір вікна: 960×600.

## 2.3 Компоненти та поведінка

### 2.3.1 TopBar
| Елемент | Поведінка |
|---------|-----------|
| Workspace switcher | Список останніх workspace, «Open folder…», «New workspace…» |
| Environment selector | Dropdown: `No environment` + список. Кнопка 👁 — popover з поточними значеннями змінних (секрети маскуються, клік — показати) |
| Settings ⚙ | Відкриває Settings як вкладку |
| Theme ◐ | Light / Dark / System (цикл) |

### 2.3.2 Sidebar — Collections
- Дерево: Collection → Folder (вкладені, без обмеження глибини) → Request.
- Рядок запиту: бейдж методу (кольори: GET зелений, POST жовтий, PUT синій, PATCH фіолетовий, DELETE червоний, HEAD/OPTIONS сірий, SOAP — бірюзовий `SOAP`), назва, `●` якщо є незбережені зміни.
- Дії (контекстне меню `…` / ПКМ): New Request, New SOAP Request, New Folder, Rename (`F2`), Duplicate (`Ctrl+D`), Delete (`Del`, з підтвердженням), Run folder (post-MVP), Export, Reveal in Explorer.
- Drag & drop: переміщення запитів/папок, зміна порядку (зберігається поле `order`).
- Фільтр: пошук за назвою та URL, підсвічування збігів, авто-розгортання.
- Кнопки в заголовку: `[+]` New Collection, `[⇩]` Import.
- Клік по запиту — відкриває в **preview-вкладці** (курсив, замінюється наступним кліком); подвійний клік або редагування — закріплює вкладку (як у VS Code).

### 2.3.3 Sidebar — Environments
- Список оточень + `Globals` зверху. Клік — відкриває **Environment Editor** вкладкою.
- Environment Editor: таблиця `☑ | Key | Value | Type (default/secret) | Description`, кнопки Duplicate env, Delete.
- Секретні значення: поле `password`, зберігаються у Keychain, в YAML — лише ключ.

### 2.3.4 Sidebar — Databases
- Список профілів з індикатором стану: ⚪ не підключено, 🟢 підключено, 🔴 помилка (tooltip з текстом).
- Розгортання профілю → дерево `schema → tables/views → columns` (ліниве завантаження).
- Дії: Connect/Disconnect, Edit, Duplicate, Delete, **New SQL tab**, на таблиці — «Select top 100», «Copy name».
- Кнопка `[+]` → **Connection Dialog**.

### 2.3.5 Sidebar — History
- Останні N (налаштування, за замовчуванням 200) виконаних запитів: метод, URL, статус, час, дата.
- Клік — відкрити snapshot (read-only вкладка з запитом і відповіддю), «Save to collection».
- Групування: Today / Yesterday / Earlier. Кнопка Clear history.

### 2.3.6 TabBar
- Типи вкладок: Request (REST), Request (SOAP), SQL Runner, Environment, Settings, History snapshot.
- `●` незбережено; `Ctrl+W` закрити (діалог «Save / Don't save / Cancel»); середня кнопка миші закриває.
- ПКМ: Close others, Close to the right, Close saved, Duplicate.
- Стан вкладок (відкриті, активна, чернетки) відновлюється після перезапуску.

### 2.3.7 UrlBar (REST)
- `Method Select` (7 методів + довільний метод, введений вручну).
- URL-поле — однорядковий CodeMirror з підсвіткою `{{var}}`: зелений — змінна визначена, червоний — невизначена; hover — tooltip зі значенням і джерелом (env/collection/global/runtime).
- Автодоповнення змінних після `{{`.
- Вставка cURL у поле URL → пропозиція «Import from cURL» (парсинг методу, заголовків, тіла).
- Двосторонній синк URL ↔ вкладка Params (query).
- Кнопка `Send` (`Ctrl+Enter`); під час виконання перетворюється на `Cancel` (`Esc`) зі спінером.
- Кнопка `Save` (`Ctrl+S`); для нового запиту — діалог вибору колекції/папки.

### 2.3.8 Вкладки Request Panel
| Вкладка | Вміст |
|---------|-------|
| **Params** | `KeyValueTable` для Query params + окремий блок Path params (автовиявлення `:id` та `{id}` в URL) |
| **Headers** | `KeyValueTable` з автодоповненням стандартних заголовків і значень (`Content-Type` → список MIME). Блок «Auto-generated headers» (згорнутий, read-only: `Content-Type`, `Content-Length`, `User-Agent`, `Host`) з можливістю перевизначити |
| **Auth** | Type: Inherit from parent / None / Basic / Bearer / API Key (header або query) . Поля підтримують `{{var}}` |
| **Body** | Type: none / JSON / XML / Text / form-urlencoded / multipart form-data / binary (file). Для raw — CodeMirror з підсвіткою, кнопка `Beautify` (`Shift+Alt+F`), валідація JSON/XML у реальному часі (маркер помилки). Для form-data — KeyValueTable з типом рядка `Text/File` |
| **Extract** | Таблиця екстракторів (див. 04-assertions.md) |
| **Checks & Asserts** | DB Checks + Assertion Builder (див. 2.5) |
| **Settings** | Timeout (ms), Follow redirects (☑, max 10), Verify TLS (☑), Proxy (inherit/none/custom), Encode URL automatically (☑) |

Лічильник у назві вкладки показує кількість увімкнених рядків: `Headers(3)`.

### 2.3.9 `KeyValueTable` (спільний компонент)
- Колонки: `☑ enabled | Key | Value | Description | 🗑`.
- Завжди є порожній «фантомний» рядок унизу — введення в нього створює новий рядок.
- Режим `Bulk edit` — перемикання на textarea формату `key: value` по рядку.
- Value підтримує підсвітку `{{var}}`; клавіша `Tab` переходить між клітинками.

### 2.3.10 Response Panel
**Статус-рядок:** `201 Created` (колір за класом 2xx/3xx/4xx/5xx) · `182 ms` (hover → Timeline) · `1.2 KB` (hover → headers/body окремо) · `Tests: 4/5` (клік → вкладка Tests) · кнопки `Copy`, `Save to file`, `Clear`.

| Вкладка | Вміст |
|---------|-------|
| **Body** | Перемикач `Pretty / Raw / Preview`. Pretty — авто-форматування за `Content-Type` (JSON, XML, HTML), CodeMirror read-only, згортання вузлів, пошук `Ctrl+F`, перенос рядків. Для JSON — кнопка `Filter` (JSONPath, результат на льоту). Preview — HTML у sandbox iframe, зображення — `<img>`. Бінарні — «Binary response, N KB · Save to file». Тіло > 2 MB — підсвітка вимикається, показ попередження |
| **Headers** | Таблиця key/value, копіювання; ПКМ на рядку → «Add assertion for this header» |
| **Cookies** | name, value, domain, path, expires, httpOnly, secure |
| **Timeline** | Діаграма фаз (TTFB / Download / Total) + сирий запит, як він був відправлений (після підстановки змінних, з маскуванням секретів) |
| **Tests** | Результати Extract / DB Checks / Assertions (див. 2.5.4) |

**Контекстні дії в Pretty JSON:** ПКМ на значенні → «Extract to variable…», «Add assertion: equals this value», «Copy JSONPath». Це головний прискорювач No-Code сценарію.

**Стани:** порожній («Send a request to see the response», підказка `Ctrl+Enter`), завантаження (спінер + таймер), помилка мережі (картка з `AppError.message`, підказки: перевірити URL/проксі/TLS), скасовано.

## 2.4 SOAP-режим

Запит типу SOAP відкривається тією ж оболонкою, з відмінностями:

- **UrlBar**: метод фіксований `POST`; додаткове поле `Operation ▾` (з WSDL) та `SOAP Version: 1.1 / 1.2`.
- Вкладка **Body** замінена на **Envelope**: XML-редактор з шаблоном:
  - 1.1: `Content-Type: text/xml; charset=utf-8` + заголовок `SOAPAction: "<action>"`.
  - 1.2: `Content-Type: application/soap+xml; charset=utf-8; action="<action>"`.
- Кнопка `Generate envelope` — будує шаблон з WSDL для вибраної операції (елементи з `?` як плейсхолдери, коментарі `<!-- optional -->`).
- Вкладка **WS-Security** (post-MVP): UsernameToken.
- **Імпорт WSDL** (з URL або файлу) створює колекцію: папка на кожен `service/port`, запит на кожну операцію. MVP: WSDL 1.1, document/literal та rpc/literal, `xsd:import`/`include` по URL. Парсинг WSDL — у Rust (`quick-xml`).
- **Response**: XML Pretty; SOAP Fault (`<soap:Fault>`) виділяється червоною карткою з `faultcode`/`faultstring` навіть при HTTP 500.
- Асерти для SOAP використовують **XPath** з авто-реєстрацією namespace-префіксів з відповіді (таблиця префіксів редагується).

## 2.5 Вкладка «Checks & Asserts»

```
┌ Checks & Asserts ────────────────────────────────────────────────────────────┐
│ ▾ DB Checks                                                    [+ Add check] │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ☑ Name: userRow   DB: [pg-dev ▾]   Run: [After response ▾]  Wait ⏱ 0ms  │ │
│ │ SELECT id, email, status FROM users WHERE id = :userId                   │ │
│ │ Params: userId ← {{userId}}                     Retry: 3 × 500ms  [▶ Run]│ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ▾ Assertions                                       [+ Add] [Text mode </>]  │
│  ☑ [Status code   ▾] [            ] [equals      ▾] [201            ]  ✔ 🗑 │
│  ☑ [JSON body     ▾] [$.email     ] [equals      ▾] [{{email}}      ]  ✔ 🗑 │
│  ☑ [DB: userRow   ▾] [rows[0].id  ] [equals      ▾] [API: $.id      ]  ✘ 🗑 │
│  ☑ [Response time ▾] [            ] [less than   ▾] [500            ]  ✔ 🗑 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.5.1 Рядок асерту (Assertion Row)
1. **Source** (Select): Status code, Response time, Header, JSON body, XML body (XPath), Body text (regex), DB check result, Variable.
2. **Path / Name** — залежить від Source (JSONPath, ім'я заголовка, XPath, `rows[0].col` / `rowCount`). Автодоповнення: для JSON — шляхи з останньої відповіді; для DB — колонки з останнього виконання DB Check.
3. **Operator** (Select) — список фільтрується під тип значення.
4. **Expected** — значення; перемикач джерела `Literal / Variable / API / DB` (іконка ліворуч у полі). Це дає порівняння `API ↔ DB` без коду.
5. Індикатор результату останнього запуску ✔ / ✘ / ○ (не виконувався); hover на ✘ — `expected X, got Y`.
6. Drag-handle для порядку; ПКМ → Duplicate, Disable.

### 2.5.2 DB Check card
- Поля: Name (ідентифікатор, `[a-zA-Z_][a-zA-Z0-9_]*`), DB profile, SQL (CodeMirror SQL з автодоповненням таблиць/колонок), Params (авто з `:name` в SQL, значення — шаблон `{{...}}` або `API: $.path`), Timing: `Wait before (ms)`, `Retry until assertions pass: N × interval ms`.
- `▶ Run` — виконати лише цей check з поточними змінними і показати результат-таблицю під карткою.

### 2.5.3 Text mode
Перемикач `</>` показує ті ж асерти як текст (двосторонній синк, див. 04-assertions.md §4.7). Помилка парсингу — підсвітка рядка; перехід назад у No-Code блокується, доки є помилки.

### 2.5.4 Вкладка Tests у Response
```
Tests  4 passed · 1 failed · 0 skipped                    [Re-run checks only]
 ▾ Extract
   ✔ userId  ← $.id            = 42
 ▾ DB Checks
   ✔ userRow (pg-dev) 1 row · 8 ms · attempt 1/3        [show rows]
 ▾ Assertions
   ✔ Status code equals 201
   ✔ $.email equals "a@b.com"
   ✘ DB userRow.rows[0].status equals "active"
       expected: "active"   actual: "pending"
   ✔ Response time < 500 ms (182)
```
`Re-run checks only` — повторно виконує DB Checks + асерти без повторного HTTP-запиту (корисно, коли запис у БД асинхронний).

## 2.6 Connection Dialog (DB)

| Поле | Postgres | MySQL/MariaDB | MS SQL Server | Azure Cosmos DB | SQLite |
|------|----------|---------------|---------------|-----------------|--------|
| Name | ✔ | ✔ | ✔ | ✔ | ✔ |
| Driver | селектор, змінює форму | | | | |
| Host / Port | ✔ (5432) | ✔ (3306) | ✔ (1433) + Instance name | Account endpoint `https://<acc>.documents.azure.com:443/` або Emulator | — |
| Database | ✔ | ✔ | ✔ | ✔ (default database) | File path (`Browse…`) |
| Auth | User / Password | User / Password | SQL Login / Windows Integrated (лише Windows-білд) | Account key (або read-only key) / Entra ID (Azure CLI login, DefaultAzureCredential) | — |
| Password storage | `Keychain` / `Ask every time` / `From env variable {{dbPass}}` | | | | |
| TLS | disable / prefer / require / verify-ca / verify-full + CA file | disabled / preferred / required / verify_ca / verify_identity | Encrypt (on/off/strict) + TrustServerCertificate | завжди HTTPS; для Emulator — «Trust emulator certificate» | — |
| Protected (заборона запису) | ☑ | ☑ | ☑ | ☑ | ☑ |
| Advanced | connect / statement timeout, application_name, додаткові параметри URL | | ApplicationIntent, додаткові параметри ADO-рядка | preferred regions, consistency level (для читання) | |

- `Connection string` — вставити URL (`postgres://…`, `mysql://…`), ADO-рядок `Server=…;Database=…` або JDBC `jdbc:sqlserver://…` для MSSQL, `AccountEndpoint=…;AccountKey=…` для Cosmos → парсинг у поля (пароль/ключ одразу в Keychain).
- `Test Connection` → inline-результат: ✔ «PostgreSQL 16.2 · 23 ms» або ✘ текст помилки драйвера.
- Збереження можливе і без успішного тесту.
- Значення Host/Port/Database можуть містити `{{var}}` (різні БД для dev/staging через Environment).

## 2.7 SQL Runner (вкладка)

```
┌ SQL: pg-dev ─────────────────────────────────────────────────────────────────┐
│ DB: [pg-dev ▾]  🟢   [▶ Run (Ctrl+Enter)] [▶ Run selection] [■ Stop]  Limit [1000]│
├──────────────────────────────────────────────────────────────────────────────┤
│ SELECT * FROM users WHERE email LIKE '%@test.com' ORDER BY id DESC;          │
├══════════════════════════════════════════════════════════════════════════════┤
│ Result 1 | Result 2 | Messages              128 rows · 14 ms · (truncated)  │
│ id │ email          │ status  │ created_at                                   │
│ 42 │ a@test.com     │ active  │ 2026-10-18 12:41:03                          │
└──────────────────────────────────────────────────────────────────────────────┘
```
- `Ctrl+Enter` — виконати statement під курсором (розбиття по `;` з урахуванням рядків/коментарів) або виділення.
- Кілька statements → кілька вкладок результату.
- Сітка: віртуалізована, сортування на клієнті, змінна ширина колонок, `NULL` сірим курсивом, JSON-клітинки — popover з форматуванням, копіювання клітинки/рядка/як CSV/як JSON/як INSERT.
- Messages: rowsAffected, помилки з позицією (якщо драйвер повертає) → підсвітка в редакторі.
- Історія SQL у межах профілю (`Ctrl+↑/↓`).
- SQL-вкладку можна зберегти у колекцію як «SQL snippet» (post-MVP).
- Деструктивні запити (`DELETE/UPDATE` без `WHERE`, `DROP`, `TRUNCATE`) — діалог підтвердження; для `protected`-профілю запис заблокований.
- **Cosmos DB-режим (Query Runner)**: селектор `Container ▾`, поле `Partition key` (опційно; порожнє = cross-partition), редактор Cosmos SQL (`SELECT * FROM c WHERE c.orderId = @orderId`) з таблицею параметрів `@name`. Окремі кнопки `Read item` (id + PK), `Upsert`, `Delete` (лише для не-protected). Результат — перемикач `Table / JSON`, у статус-рядку — RU charge. Дерево в Sidebar: `database → containers (partition key path) → поля (за семплом 100 документів)`.

## 2.8 Settings (вкладка)
- **General**: тема, мова UI (uk / en), розміщення панелей, розмір шрифту редактора, відновлення вкладок при старті.
- **Request defaults**: timeout (30 000 ms), follow redirects, verify TLS, max response size для відображення (10 MB), User-Agent.
- **Proxy**: system / none / manual (http/https/socks5, bypass list).
- **Certificates**: custom CA (PEM), client certificates per host (PFX/PEM) — post-MVP.
- **History**: кількість записів, чи зберігати тіла відповідей.
- **Data**: шлях app-data, «Open logs folder».
- **Shortcuts**: таблиця (read-only в MVP).

## 2.9 Гарячі клавіші

| Дія | Win/Linux | macOS |
|-----|-----------|-------|
| Send / Run SQL | `Ctrl+Enter` | `⌘↵` |
| Cancel | `Esc` | `Esc` |
| Save | `Ctrl+S` | `⌘S` |
| New request | `Ctrl+N` | `⌘N` |
| New SQL tab | `Ctrl+Shift+Q` | `⌘⇧Q` |
| Close tab | `Ctrl+W` | `⌘W` |
| Next / prev tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | `⌃Tab` |
| Toggle sidebar | `Ctrl+B` | `⌘B` |
| Command palette / quick open | `Ctrl+K` / `Ctrl+P` | `⌘K` / `⌘P` |
| Beautify body | `Shift+Alt+F` | `⇧⌥F` |
| Switch environment | `Ctrl+E` | `⌘E` |
| Rename | `F2` | `F2` |

**Command palette** (`Ctrl+K`, shadcn `Command`): пошук по запитах, оточеннях, БД-профілях та командах.

## 2.10 Інвентар компонентів shadcn/ui
`Button, Input, Textarea, Select, Combobox(Command+Popover), Tabs, Dialog, AlertDialog, DropdownMenu, ContextMenu, Tooltip, Popover, Badge, Switch, Checkbox, Resizable, ScrollArea, Separator, Toast (sonner), Command, Table, Skeleton, Collapsible, Sheet`.

Власні компоненти: `CodeEditor`, `VariableInput` (однорядковий CM з підсвіткою), `KeyValueTable`, `MethodBadge`, `StatusBadge`, `ResultGrid`, `TreeView` (з DnD — `@dnd-kit`), `AssertionRow`, `DbCheckCard`, `TestResultList`, `TimelineChart`.
