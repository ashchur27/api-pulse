# 05. Детальний план розробки (Roadmap)

Нумерація задач: `P<фаза>-<епік>.<задача>`. Фази ідуть послідовно; кожна завершується робочим білдом, який можна встановити і протестувати.

**Робочий процес (2 учасники):**
- Розробник (AI-асистент): реалізація задач епіку, тести, оновлення docs.
- Власник: рев'ю коду епіку, ручне тестування на реальних API/БД команди, продуктові рішення, прийняття фази.
- Цикл: епік → коміти в гілці → демо/рев'ю → фікси → merge. Релізи `v0.x` після кожної фази з фази 2 — щоб команда пробувала рано.

**Definition of Done (для кожної задачі):**
- Код пройшов `cargo clippy -D warnings`, `cargo fmt --check`, `eslint`, `tsc --noEmit`.
- Unit-тести для логіки (Rust — обов'язково для `runner`, `vars`, `db/params`, `storage`).
- Працює на Windows + macOS + Linux у CI (збірка) і вручну перевірено хоча б на одній ОС.
- Обидві теми (Light/Dark) виглядають коректно.
- Немає секретів у логах.

---

## Фаза 0: Підготовка

| ID | Задача | Критерії приймання |
|----|--------|--------------------|
| P0-1 | Зафіксувати ADR (docs/README.md), погодити формат файлів | Документ погоджено |
| P0-2 | Клікабельний прототип головного екрана (Figma або одразу в коді на mock-даних) | Пройдено сценарій A з 04-assertions §4.6 на макеті |
| P0-3 | Репозиторій: гілкова модель (trunk + PR), Conventional Commits, шаблони PR/issue, LICENSE | |
| P0-4 | Тестові стенди: `docker-compose.dev.yml` з Postgres 16, MySQL 8, MariaDB 11, MS SQL Server 2022, Cosmos DB Emulator (Linux-образ), демо REST API і SOAP-сервіс (власний маленький сервіс Orders/Users, що пише в ці БД — для наскрізніх сценаріїв) | `docker compose up` піднімає все; seed-дані |
| P0-5 | ✔ Проаналізовано 34 SoapUI-проєкти команди — див. [07-soapui-analysis.md](07-soapui-analysis.md) | Список типів кроків/асертів, які реально використовуються |

---

## Фаза 1: Каркас UI та збереження

### Епік P1-1. Ініціалізація проєкту
| ID | Задача | Критерії |
|----|--------|----------|
| P1-1.1 | `npm create tauri-app` (React + TS + Vite), Tauri v2, strict TS | `npm run tauri dev` запускає вікно |
| P1-1.2 | Tailwind + shadcn/ui init, базові компоненти (§2.10), шрифт Inter + JetBrains Mono | Storybook не обов'язковий; сторінка `/dev/kitchen-sink` у dev-режимі |
| P1-1.3 | ESLint (typescript-eslint, react-hooks), Prettier, Husky + lint-staged | pre-commit працює |
| P1-1.4 | Rust: структура модулів (§1.3), `AppError`, `tracing` у файл з ротацією | помилка Rust показується в UI тостом з `message` |
| P1-1.5 | `tauri-specta`: генерація `src/ipc/bindings.ts` | зміна Rust-типу ламає `tsc` |
| P1-1.6 | Capabilities v2 мінімальні, CSP | `tauri build` без попереджень про дозволи |
| P1-1.7 | CI (`ci.yml`): lint + test + build на win/mac/linux | зелений пайплайн на PR |

### Епік P1-2. Layout
| ID | Задача | Критерії |
|----|--------|----------|
| P1-2.1 | `AppShell`: TopBar, ActivityBar, Sidebar, робоча область, StatusBar; `react-resizable-panels` | розміри панелей зберігаються в `state.json` |
| P1-2.2 | `TabBar` + `tabsStore` (типи вкладок, preview-вкладка, dirty-стан, закриття з підтвердженням, ПКМ-меню) | §2.3.6 |
| P1-2.3 | Request Panel / Response Panel заглушки з вкладками; перемикач bottom/right | |
| P1-2.4 | Теми: CSS-змінні shadcn, `class="dark"`, режим System через `prefers-color-scheme` + подія зміни теми Tauri | без «спалаху» білого при старті (тема застосовується до першого рендеру) |
| P1-2.5 | Гарячі клавіші — центральний `useHotkeys` реєстр; Command Palette (каркас) | §2.9 базові |
| P1-2.6 | i18n (`i18next`), uk + en | усі рядки через `t()` |

### Епік P1-3. Storage (Rust) + Collections UI
| ID | Задача | Критерії |
|----|--------|----------|
| P1-3.1 | Rust моделі (§3.3–3.8) + `serde` + `schemars`; стабільний порядок полів | round-trip тест: read → write → байт-у-байт той самий файл |
| P1-3.2 | `workspace_open/create`, сканування дерева, валідація, звіт про пошкоджені файли (не падати — показати ⚠ у дереві) | 1000 запитів < 1 c |
| P1-3.3 | CRUD колекцій/папок/запитів, slug-імена, перейменування файлів, `order` | атомарний запис (temp file + rename) |
| P1-3.4 | File watcher (`notify`) → подія `workspace://changed`, ігнор власних записів | `git checkout` іншої гілки оновлює дерево |
| P1-3.5 | `workspaceStore` (Zustand) + `TreeView` з DnD (`@dnd-kit`), фільтр, контекстне меню | §2.3.2 |
| P1-3.6 | Чернетки вкладок (`drafts/`), відновлення сесії | kill процесу → після рестарту незбережені зміни на місці |
| P1-3.7 | `settings.json` + сторінка Settings (General) | |
| P1-3.8 | Міграційний каркас `schemaVersion` + бекап | тест з фікстурою v0 → v1 |

**Результат фази:** додаток відкриває папку, показує/редагує дерево колекцій, вкладки, теми, усе зберігається у YAML.

---

## Фаза 2: REST та SOAP клієнт

### Епік P2-1. HTTP-двигун (Rust)
| ID | Задача | Критерії |
|----|--------|----------|
| P2-1.1 | `http_send`: побудова `reqwest::Request` з `ResolvedRequest`; методи + довільний | wiremock-тести на кожен метод |
| P2-1.2 | Тіла: raw, form-urlencoded, multipart (файли стрімом), binary | multipart з файлом 50 MB не вантажить RAM повністю |
| P2-1.3 | Auth: basic, bearer, apiKey (header/query), успадкування | |
| P2-1.4 | Таймаут, редиректи (з лічильником), verifyTls, проксі (system/manual/socks5), cookie jar per workspace | |
| P2-1.5 | Таймінги (TTFB/download/total), розміри, http version | |
| P2-1.6 | Тіло відповіді: декомпресія, визначення text/binary (charset з `Content-Type`, `encoding_rs`), ліміт `maxDisplayBytes` + збереження повного в temp-файл | 50 MB відповідь не фрізить UI |
| P2-1.7 | Скасування (`http_cancel`) | Esc під час повільного запиту → `CANCELLED` < 100 мс |
| P2-1.8 | Маскування секретів у логах/snapshot | тест |

### Епік P2-2. Змінні (базово, потрібно вже тут)
| ID | Задача | Критерії |
|----|--------|----------|
| P2-2.1 | `vars::resolver`: пріоритети, рекурсія, цикли, escape, типізована підстановка | §4.8 Resolver |
| P2-2.2 | Динамічні змінні §4.2.3 | |
| P2-2.3 | Environments: CRUD, Globals, селектор у TopBar, Environment Editor | |
| P2-2.4 | Секрети: `keyring`, fallback-файл, `secretRef` у UI | працює на всіх 3 ОС (Linux — з gnome-keyring у CI) |
| P2-2.5 | `VariableInput` (CodeMirror single-line): підсвітка визначених/невизначених, tooltip, автодоповнення | |

### Епік P2-3. Request Editor UI
| ID | Задача | Критерії |
|----|--------|----------|
| P2-3.1 | `UrlBar`: метод, URL ↔ Params синк, path params, Send/Cancel, Save | |
| P2-3.2 | `KeyValueTable` (фантомний рядок, bulk edit, Tab-навігація) | перевикористано в Params/Headers/Form/Env |
| P2-3.3 | Headers з автодоповненням + auto-generated headers | |
| P2-3.4 | Auth вкладка | |
| P2-3.5 | Body: типи, CodeMirror JSON/XML/Text, beautify, валідація | |
| P2-3.6 | Request Settings вкладка | |
| P2-3.7 | Import from cURL / Copy as cURL | 20 реальних cURL-прикладів у тестах |

### Епік P2-4. Response Viewer
| ID | Задача | Критерії |
|----|--------|----------|
| P2-4.1 | Статус-рядок (колір, час, розмір, hover-деталі) | |
| P2-4.2 | Body Pretty/Raw/Preview; форматування JSON/XML у Rust (команда `format_body`), згортання, пошук, перенос | 5 MB JSON без фрізу > 100 мс |
| P2-4.3 | Headers, Cookies, Timeline вкладки | |
| P2-4.4 | Бінарні відповіді, зображення, Save to file | |
| P2-4.5 | JSONPath-фільтр у Pretty JSON | |
| P2-4.6 | History: запис `jsonl` + snapshot, Sidebar History, відкриття snapshot | |

### Епік P2-5. SOAP
| ID | Задача | Критерії |
|----|--------|----------|
| P2-5.1 | Тип запиту `soap`: UI-відмінності §2.4, версія 1.1/1.2, авто `Content-Type`/`SOAPAction` | |
| P2-5.2 | WSDL-парсер (Rust): services/ports/operations/messages, `xsd:import` по URL | 5 реальних WSDL (у т.ч. WCF) у фікстурах |
| P2-5.3 | Генератор envelope з XSD (complexType, sequence, minOccurs → коментар optional, enum → перше значення) | |
| P2-5.4 | Імпорт WSDL → колекція | |
| P2-5.5 | SOAP Fault розпізнавання та картка | |
| P2-5.6 | XXE-захист: тест з зовнішньою сутністю | сутність не розкривається |

**Результат фази:** повноцінний ручний REST/SOAP-клієнт зі змінними та оточеннями.

---

## Фаза 3: Бази даних та Query Runner

### Епік P3-1. DB-двигун (Rust)
| ID | Задача | Критерії |
|----|--------|----------|
| P3-1.1 | Трейт `DbDriver`, `PoolManager`: пул на профіль, ліниве підключення, idle-закриття, резолв `{{vars}}` в host/db | |
| P3-1.2 | `sqlx`-драйвер: Postgres/MySQL/SQLite, SSL-режими, timeouts | testcontainers: SSL require працює |
| P3-1.2a | **MSSQL-драйвер** (`tiberius` + `bb8`): SQL Login, Windows auth (лише Windows), named instance, Encrypt/TrustServerCertificate, T-SQL батчі з `DECLARE`/`IF`/`BEGIN`, stored procedures (`EXEC`), кілька result set, `@P1` плейсхолдери, парсинг JDBC/ADO connection string | testcontainers `mssql/server:2022`; 10 реальних запитів зі SoapUI-проєктів виконуються без змін |
| P3-1.2b | **Cosmos DB-драйвер** (`azure_data_cosmos` + `azure_identity`): key / Entra auth, query з `@params` (single / cross-partition), read / upsert / delete, пагінація continuation token, RU charge, емулятор | Cosmos Emulator у CI; реальний акаунт команди — ручна перевірка |
| P3-1.2c | Пули з ключем за резолвленими параметрами (динамічний host з змінної, 01-architecture §1.4) | один профіль → різні сервери в одному запуску |
| P3-1.3 | `db_test_connection` (версія сервера, latency) | зрозумілі помилки: auth failed / host unreachable / db not found |
| P3-1.4 | `db_execute`: кілька statements, `maxRows`, rowsAffected, statement timeout, скасування (`pg_cancel_backend` / `KILL QUERY` / TDS attention / `sqlite3_interrupt` / `killOp`) | |
| P3-1.5 | `db/value.rs`: нормалізація типів у `CellValue` (numeric/decimal/money, bigint, date/time/datetime2/datetimeoffset/timestamptz, uuid/uniqueidentifier, json/jsonb, bytea/varbinary/blob, PG arrays, enum, bit, ObjectId, Decimal128) | таблична матриця тестів по кожній СУБД |
| P3-1.6 | Метадані: схеми, таблиці, views, колонки (`information_schema` / `sys.*` / `sqlite_master`); Cosmos — бази, контейнери, partition key path, поля за семплом | |
| P3-1.7 | `db/params.rs`: парсер `:name` → `$n` / `?` / `@Pn` (ігнор рядків, коментарів, `::`) | §4.8 SQL params |
| P3-1.8 | `db/guard.rs`: режими `check`/`setup`, `protected`-профілі, `sqlparser`-класифікація, детектор деструктивних запитів | `UPDATE` у check-режимі не змінює дані в жодній з 5 СУБД |

### Епік P3-2. DB UI
| ID | Задача | Критерії |
|----|--------|----------|
| P3-2.1 | Sidebar Databases: список, статуси, ліниве дерево схеми | |
| P3-2.2 | Connection Dialog (форма per driver, connection string парсинг, Test Connection, password modes) | §2.6 |
| P3-2.3 | SQL Runner вкладка: CodeMirror SQL (діалект за драйвером, автодоповнення з метаданих), Run / Run selection / statement під курсором, Stop, Limit | §2.7 |
| P3-2.4 | `ResultGrid`: віртуалізація, сортування, ресайз колонок, NULL-стиль, JSON popover, копіювання (CSV/JSON/INSERT) | 100k рядків плавно |
| P3-2.5 | Messages, кілька result-вкладок, позиція помилки | |
| P3-2.6 | Історія SQL per профіль | |
| P3-2.7 | Cosmos Query Runner (container, partition key, Cosmos SQL + `@params`, read/upsert/delete, Table/JSON, RU) | 02-ux-ui §2.7 |

**Результат фази:** окремий робочий DB-клієнт для MSSQL, Cosmos DB, Postgres, MySQL/MariaDB, SQLite.

---

## Фаза 4: Двигун перевірок API ➔ DB

### Епік P4-1. Runner (Rust)
| ID | Задача | Критерії |
|----|--------|----------|
| P4-1.1 | `runner::pipeline` §4.1, `run_request`, `RunResult` | |
| P4-1.2 | Extractors: jsonBody (`serde_json_path`), xmlBody (`sxd-xpath` + namespaces), header, cookie, regex, status, dbCheck; scopes; запис runtime vars | §4.8 Extract |
| P4-1.3 | DB Checks: параметри з шаблонів і `API: $.path`, waitBefore, retry з прив'язкою до асертів, maxRows | §4.8 Retry |
| P4-1.4 | `compare.rs` + оператори §4.5.2 + приведення типів §4.5.3 | ≥ 100 табличних тестів |
| P4-1.5 | Асерти: розрахунок `actual`/`expected` з `ValueRef`, повідомлення | |
| P4-1.6 | `Re-run checks only` (команда `run_checks` з кешованою відповіддю) | |
| P4-1.7 | Інтеграційні тести: wiremock API + testcontainers DB, сценарії A/B/C з §4.6 | зелені в CI (Linux) |
| P4-1.8 | Додаткові типи перевірок §4.9: `jsonSchema`, `soapFault`, `rowMatchesObject`, `countMatches` | |
| P4-1.9 | `xsdCompliance` для SOAP (XSD-модель з WSDL-парсера) та `bodyMatchesSnapshot` | Should |

### Епік P4-2. UI перевірок
| ID | Задача | Критерії |
|----|--------|----------|
| P4-2.1 | Вкладка Extract (таблиця екстракторів) | |
| P4-2.2 | `DbCheckCard`: профіль, SQL з автодоповненням, авто-параметри з `:name`, валідація `{{}}` у SQL, ▶ Run з результатом | |
| P4-2.3 | `AssertionRow`: Source → Path (з автодоповненням з останньої відповіді/результату) → Operator (фільтр за типом) → Expected (Literal/Variable/API/DB) | |
| P4-2.4 | Контекстні дії у Response Pretty JSON/XML і ResultGrid: Extract to variable, Assert equals, Compare with DB, Copy path | сценарій A виконується без ручного введення шляхів |
| P4-2.5 | Вкладка Tests у Response + лічильник у статус-рядку, індикатори ✔/✘ біля рядків асертів | §2.5.4 |
| P4-2.6 | Popover змінних 👁 (ефективні значення + джерела), Clear runtime vars | |
| P4-2.7 | Текстовий режим асертів: парсер/форматер (Rust, `winnow`), двосторонній синк | §4.7 |

**Результат фази:** MVP-функціональність «відправив запит → автоматично перевірив API і БД».

---

## Фаза 5: Сценарії та Runner (06-scenarios.md)

### Епік P5-1. Модель і збереження
| ID | Задача | Критерії |
|----|--------|----------|
| P5-1.1 | Rust-моделі Suite/Scenario/Step, YAML round-trip, JSON Schema | §6.3 |
| P5-1.2 | CRUD suite/scenario/step, файли фікстур (`file: ./fixtures/*.sql`) | |
| P5-1.3 | `ValueRef { kind: step }`, валідація посилань на існуючі кроки та порядок | посилання на наступний крок — помилка валідації |

### Епік P5-2. Scenario Runner (Rust)
| ID | Задача | Критерії |
|----|--------|----------|
| P5-2.1 | `runner::scenario`: Setup → Steps → Teardown, `onFailure`, таймаут сценарію, ізольований runtime-scope | §6.4 |
| P5-2.2 | Кроки: request (з overrides), sql, cosmos, setVariables, delay, assert, manual | |
| P5-2.2a | Suite-змінні (`scope: suite`), `runMode: sequential`, `dependsOn`, кеш suite-значень для запуску одного сценарію | 06-scenarios §6.4 п.9 |
| P5-2.3 | Cleanup-стек LIFO; Teardown при fail/cancel/timeout | тест: падіння на кроці 2 → дані з setup видалені в усіх 5 СУБД |
| P5-2.4 | Suite setup/teardown, `run_suite`, фільтр за тегами | |
| P5-2.5 | Події прогресу `runner://step` / `runner://scenario` | UI оновлюється живцем |
| P5-2.6 | `run_step` / Run from here (дебаг з поточним станом змінних) | |
| P5-2.7 | Data-driven: csv / json / sql джерела, ітерації | Should |
| P5-2.8 | Наскрізні тести з демо-сервісом P0-4 | |

### Епік P5-3. UI сценаріїв
| ID | Задача | Критерії |
|----|--------|----------|
| P5-3.1 | Sidebar Scenarios: дерево, статуси останнього запуску, теги | |
| P5-3.2 | Scenario Editor: список кроків з секціями і DnD, редактор кроку (перевикористання RequestEditor/DbCheckCard/AssertionRow) | |
| P5-3.3 | DnD запиту з Collections → request-крок; «Convert to scenario» з запиту | |
| P5-3.4 | Живий прогрес, панель змінних, Result кроку | |
| P5-3.5 | Run report: дерево результатів, фільтр failed, історія запусків | |
| P5-3.6 | Експорт HTML-звіту | Should |

### Епік P5-4. Імпорт SoapUI
| ID | Задача | Критерії |
|----|--------|----------|
| P5-4.1 | Парсер SoapUI project XML: інтерфейси (WSDL/REST), запити, властивості Project/TestSuite/TestCase → змінні environment/suite/scenario; `${#Scope#Name}` → `{{Name}}` | усі 34 проєкти команди імпортуються без помилок |
| P5-4.2 | TestSuite/TestCase/TestStep → Suite/Scenario/Step, мапінг асертів (07-soapui-analysis §7.4) | `ImportReport` з відсотком автоконвертації по проєкту |
| P5-4.3 | JDBC-кроки: SQL з `'${prop}'` → `:prop` (з прибиранням лапок), автовизначення `mode: setup` для батчів зі записом; connection string property → DB-профіль (без паролів) | |
| P5-4.4 | **Конвертер типових Groovy-шаблонів** (07-soapui-analysis §7.5): `getXmlHolder(JDBC).getNodeValue("//COL")` + `setPropertyValue` → екстрактори; JSON-порівняння з property → асерти. Нерозпізнані скрипти → disabled-крок з кодом | ≥ 70% Groovy-кроків конвертуються автоматично |
| P5-4.5 | JDBC `Simple Contains` з XML-фрагментом `<COL>value</COL>` → асерти `rows[n].COL == value` | |

**Результат фази:** команда може перенести тести з SoapUI і запускати сценарії з сетапом і прибиранням даних.

---

## Фаза 6: Полірування, тестування, реліз MVP

### Епік P6-1. Якість
| ID | Задача | Критерії |
|----|--------|----------|
| P6-1.1 | E2E (WebdriverIO + `tauri-driver`, Windows та Linux): створити колекцію → запит → сценарій з setup/check/teardown → PASSED | 5 ключових сценаріїв |
| P6-1.2 | Перф-бенчмарки з §1.7, профілювання RAM/старту | всі цілі виконані або задокументовані відхилення |
| P6-1.3 | Fuzz/robustness: пошкоджені YAML, величезні відповіді, обрив з'єднання з БД посеред сценарію | без паніки, Teardown виконано |
| P6-1.4 | Аудит безпеки: `cargo audit`, `npm audit`, CSP/capabilities, маскування секретів, XXE, HTML preview sandbox, guard запису в БД, ін'єкції через параметри SQL/Cosmos | |
| P6-1.5 | Доступність: навігація клавіатурою, контраст (axe DevTools) | |
| P6-1.6 | Імпорт Postman v2.1 + Environment | 3 реальні колекції |
| P6-1.7 | Пілот у команді: перенести 1 реальний SoapUI-проєкт і проганяти тиждень паралельно | список блокерів закрито |

### Епік P6-2. Збірка та реліз
| ID | Задача | Критерії |
|----|--------|----------|
| P6-2.1 | `release.yml` з `tauri-apps/tauri-action`: Windows `.msi` + NSIS `.exe`, macOS `.dmg` (universal: x64 + arm64), Linux `.AppImage` + `.deb` | артефакти в GitHub Release на тег `v*` |
| P6-2.2 | Підпис: Windows (Authenticode / Azure Trusted Signing), macOS (Developer ID + notarization) | без попереджень SmartScreen/Gatekeeper (Windows — після накопичення репутації) |
| P6-2.3 | Оптимізація розміру: `opt-level="s"`, `lto=true`, `codegen-units=1`, `strip=true`, `panic="abort"`; лише потрібні features; code splitting у Vite | `.msi` < 20 MB (з урахуванням `tiberius` + `azure_data_cosmos` — міряти з фази 3) |
| P6-2.4 | Версіонування (SemVer), CHANGELOG (з Conventional Commits), About-діалог | |
| P6-2.5 | Updater (`tauri-plugin-updater`) — opt-in | post-MVP, якщо не вкладаємось |

### Епік P6-3. Документація
| ID | Задача |
|----|--------|
| P6-3.1 | README: що це, скріншоти, встановлення, швидкий старт за 5 хвилин |
| P6-3.2 | User Guide: колекції, змінні, SOAP/WSDL, DB-профілі, асерти, сценарії, гарячі клавіші |
| P6-3.3 | «Перехід з SoapUI»: таблиця відповідностей понять, що імпортується, що — ні |
| P6-3.4 | Формат файлів (публікація JSON Schema), робота з Git, `.gitignore` для `.apipulse/` |
| P6-3.5 | Приклад workspace `examples/` з docker-compose стендом |

---

## 5.6 Стратегія тестування (зведено)

| Рівень | Інструмент | Що покриваємо | Ціль покриття |
|--------|-----------|---------------|---------------|
| Rust unit | `cargo test` | vars, compare, params, extract, storage round-trip, migrate | ≥ 85% для `runner/`, `vars/`, `db/params` (`cargo llvm-cov`) |
| Rust integration | `testcontainers`, `wiremock` | HTTP-двигун, DB-драйвери, pipeline | усі СУБД × основні типи |
| Frontend unit | Vitest + RTL | stores, KeyValueTable, AssertionRow, URL↔Params синк | ключові компоненти |
| E2E | WebdriverIO + tauri-driver | наскрізні сценарії | 5 сценаріїв |
| Manual | чек-лист релізу | 3 ОС, обидві теми, HiDPI | перед кожним релізом |

Примітка: `tauri-driver` не підтримує macOS (немає WebDriver для WKWebView) — macOS перевіряється вручну за чек-листом.

## 5.7 CI/CD

- `ci.yml` (PR): matrix `windows-latest`, `macos-latest`, `ubuntu-22.04` → `npm ci`, `lint`, `tsc`, `vitest`, `cargo fmt/clippy/test`, `tauri build --debug` (лише Linux для швидкості, повна матриця — nightly). Інтеграційні тести з testcontainers — лише Linux.
- `release.yml` (tag `v*`): повна збірка, підпис, draft GitHub Release.
- Кешування: `Swatinem/rust-cache`, npm cache.

## 5.8 Ризики та скорочення скоупу

| Ризик | Ймовірність | Вплив | Мітигація |
|-------|-------------|-------|-----------|
| Обсяг MVP зріс (сценарії, 5 СУБД, імпорт SoapUI) | Висока | Високий | Релізи `v0.x` після кожної фази; строгий MoSCoW нижче |
| MSSQL Windows Integrated Auth на macOS/Linux (Kerberos) | Середня | Середній | MVP: Integrated лише на Windows; на інших ОС — SQL Login |
| Реальні SoapUI-проєкти сильно залежать від Groovy | Середня | Високий | Задача P0-5: порахувати, що саме роблять скрипти, і покрити найчастіше No-Code кроками; решта — JS-скрипти post-MVP |
| WSDL-парсинг складних схем (WCF, вкладені imports, polymorphism) | Висока | Середній | MVP: document/literal, рекомендовано «вставити envelope вручну» як fallback |
| Нормалізація типів БД (Postgres arrays/enum/custom types) | Середня | Середній | Невідомий тип → рядок через `::text` / сирі байти з позначкою |
| Keychain на Linux недоступний | Середня | Низький | fallback-файл з попередженням |
| Розмір інсталятора > 20 MB через `sqlx` × 3 драйвери + `reqwest` | Середня | Низький | rustls замість native-tls, мінімальні features, `strip`, вимір на кожному PR |
| Підпис/нотаризація macOS займає час (Apple Developer акаунт) | Середня | Середній | Оформити акаунт у фазі 0 |
| Різна поведінка WebView (WebView2 / WKWebView / WebKitGTK) | Середня | Середній | Не покладатися на новітні CSS/JS API; ручний прогін на 3 ОС щотижня |

### Пріоритезація MVP (MoSCoW)
- **Must:** колекції/папки/запити у YAML, REST усі методи, тіла JSON/XML/form, змінні + оточення, секрети, Response Pretty, SOAP з ручним envelope + SOAPAction, **MSSQL, Cosmos DB, Postgres, MySQL/MariaDB**, Test Connection, Query Runner, Extract (JSON/XPath/header), DB Checks з параметрами та retry, асерти No-Code, порівняння API↔DB, `rowMatchesObject`, `soapFault`, `jsonSchema`, **сценарії з Setup/Steps/Teardown і cleanup-стеком**, guard запису (check/setup/protected), інсталятори 3 ОС.
- **Should:** імпорт SoapUI, WSDL-імпорт і генерація envelope, `xsdCompliance`, `bodyMatchesSnapshot`, data-driven, HTML-звіт, cURL import/export, Postman import, History, контекстні дії «Extract/Assert from response», текстовий режим асертів, SQLite.
- **Could:** Command Palette, JSONPath-фільтр у відповіді, Timeline-діаграма, копіювання як INSERT, i18n en.
- **Won't (post-MVP):** CLI для CI + JUnit, OpenAPI/Bruno імпорт, WS-Security, client certificates, OAuth2 flows, JS-скрипти, Oracle, Redis, GraphQL, gRPC, updater, синхронізація/хмара.

## 5.9 Після MVP (v0.2+)
1. **CLI** `api-pulse run scenarios/ --env dev --tags smoke --reporter junit,html` — той самий Rust `runner`, окремий бінар без Tauri (ADR-06).
2. JS-скрипти pre/post (QuickJS через `rquickjs`) як заміна Groovy для складних випадків.
3. OAuth 2.0 (Client Credentials, Auth Code + PKCE), client certs, WS-Security.
4. Oracle (через Oracle Instant Client), Redis, MongoDB.
5. Mock-сервер для REST/SOAP на базі тих самих колекцій (аналог SoapUI MockService). Команда зараз запускає 5 mock-сервісів через `Runners/*.bat` — до появи заміни вони працюють паралельно без змін.
6. OpenAPI 3 та Bruno імпорт.
