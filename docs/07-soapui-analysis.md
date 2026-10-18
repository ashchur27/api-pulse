# 07. Аналіз SoapUI-проєктів команди

Джерело: `C:\Cantaloupe\Versioned\scripts\build\SoapUI` (SoapUI 5.7.0), 34 файли `*-soapui-project.xml`. `soapui-settings.xml` не аналізувався. Аналіз автоматичний (підрахунок XML-елементів і шаблонів у Groovy); облікові дані не виводились.

## 7.1 Масштаб

| Показник | Значення |
|----------|----------|
| Проєкти з тестами | 32 (+2 проєкти лише з mock-сервісами) |
| TestSuites / TestCases / TestSteps | 48 / 344 / 1 672 |
| Найбільший проєкт | SeedMobile-DriverWebApi — 54 кейси, 451 крок, 1.1 MB XML |
| Інтерфейси | 28 REST services, 11 WSDL (SOAP) |
| Mock-сервіси | 5 (SaasQaMockServices ×4, RestMockServer ×1) — запускаються як сервери через `Runners/*.bat` |
| Load / Security tests | 3 / 1 — практично не використовуються |
| Вимкнені кроки | 50 |

## 7.2 Типи кроків

| SoapUI step | Кількість | Частка | API-Pulse |
|-------------|-----------|--------|-----------|
| `restrequest` | 921 | 55% | `request` (REST); 920 з 921 — `application/json` |
| `jdbc` | 315 | 19% | `sql` (усі — **MS SQL Server**) |
| `request` (SOAP) | 235 | 14% | `request` (SOAP) |
| `groovy` | 173 | 10% | конвертер шаблонів → `extract` / `assert`; решта — disabled + код (§7.5) |
| `manualTestStep` | 18 | 1% | `manual` |
| `httprequest` | 9 | <1% | `request` (REST) |
| `delay` | 1 | <1% | `delay` |
| `transfer`, `properties`, DataSource | 0 | — | не потрібні (команда робить це в Groovy) |

## 7.3 Бази даних

- Драйвер у всіх 315 JDBC-кроках — `${SQLServerDriver}` → **тільки MS SQL Server**.
- Connection strings — з властивостей: `${#Project#OperatorCatalogConnectionString}` (189), `${SeedMasterConnectionString}` (78), `${NoLogBackupConnectionString}` (36, +5 QA-варіант) та ін. Глобальні значення живуть у `soapui-settings.xml` → при імпорті створюються DB-профілі з порожнім паролем, який вводиться один раз (Keychain).
- Перше ключове слово запитів: `SELECT` 207, `DECLARE` 71, `UPDATE` 26, `DELETE` 5, `BEGIN` 3, `INSERT` 2, `IF` 1. 52 T-SQL-батчі (`DECLARE`/`IF`/`BEGIN`) містять запис — це **сетап тестових даних** (`if not exists ... insert`). 19 запитів викликають stored procedures.
- Параметризація — **тільки текстова** (`where Code = '${#Project#OperatorCode}'`), жодного JDBC-кроку з параметрами. API-Pulse при імпорті перетворює `'${#X#Name}'` → `:Name` (bind-параметр).
- **Динамічний хост БД**: кейси `SetupDbHostInProjectProperties` запитують каталог (`Catalog → DataSource.Host` за `DatabaseName`) і записують `DataBaseHost` у project properties; наступні JDBC-кроки йдуть на цей хост. → профіль `host: "{{DataBaseHost}}"`, пули з ключем за резолвленими параметрами (01-architecture §1.4).
- Колонки в результатах JDBC SoapUI віддає у **верхньому регістрі** (`//HOST`, `//MICROMARKETID`) → зіставлення колонок без урахування регістру (04-assertions §4.4.3).
- Cosmos DB у SoapUI-проєктах не використовується (0 згадок) — це нова можливість, якої в SoapUI немає.

## 7.4 Асерти

| SoapUI assertion | На кроках | Кількість | API-Pulse |
|------------------|-----------|-----------|-----------|
| Simple Contains | REST 753, SOAP 196, JDBC 108, HTTP 7 | 1 064 | REST/SOAP → `bodyText contains`; JDBC з `<COL>value</COL>` → `rows[n].COL == value` |
| Valid HTTP Status Codes | REST 764, SOAP 212, HTTP 8 | 984 | `status in [...]` |
| JDBC Status | JDBC | 312 | не потрібен: SQL-крок з помилкою автоматично `ERROR` |
| GroovyScriptAssertion | REST 70, SOAP 4, JDBC 3 | 77 | `rowMatchesObject` / набір `jsonBody` асертів (§7.5) |
| JsonPath Match | REST | 43 | `jsonBody eq` |
| JsonPath Existence Match | REST | 37 | `jsonBody exists` |
| Simple NotContains | REST 7, SOAP 1 | 8 | `bodyText notContains` |
| XPath Match | JDBC | 6 | `dbCheck` path |
| Invalid HTTP Status Codes | REST | 6 | `status notIn [...]` |
| SOAP Response | SOAP | 4 | `notSoapFault` |

Висновки:
- Типи `Schema Compliance`, `SOAP Fault`, `Response SLA`, `XQuery`, `Script` на рівні тест-кейсу — **не використовуються**. MVP-набору асертів з 04-assertions вистачає з запасом.
- `Simple Contains` для REST: 408 — звичайний текст (переважно тексти помилок валідації `The DeviceId field is required`), 303 — фрагменти `"key": value`. Другі крихкі (залежать від пробілів і порядку). Імпорт зберігає їх як є, а UI пропонує дію «Convert to JSONPath assertion» для фрагментів `"key": value` → `$.key == value`.

## 7.5 Groovy: що саме роблять скрипти

250 скриптів (173 кроки + 77 асертів), 4 468 рядків. Setup/TearDown-скриптів на рівні TestCase/Suite/Project — **0**.

| Шаблон | Скриптів | Призначення | Заміна в API-Pulse |
|--------|----------|-------------|---------------------|
| `setPropertyValue` | 169 | Записати значення у властивість (переважно TestSuite) | `extract` зі `scope: suite` |
| `XmlHolder.getNodeValue("//COL")` | 147 | Прочитати колонку з результату JDBC-кроку | `extract` з `dbCheck` path |
| `JsonSlurper` | 89 | Розібрати JSON-відповідь | JSONPath |
| `assert` | 83 | Порівняти поля відповіді з властивостями | `jsonBody` асерти / `rowMatchesObject` |
| `getPropertyValue` / `context.expand` | 48 | Прочитати властивість | `{{var}}` |
| `safeParseInt` / `safeParseDouble` | у більшості Groovy-асертів | Звести рядок з БД до числа перед порівнянням | вбудоване приведення типів (04-assertions §4.5.3) |
| цикли | 17 | Порівняння масивів | `rowMatchesObject` для масивів, `rows[*]` |
| Random/UUID, дати, File IO, exec | ≤ 5 кожне | Рідкісні випадки | динамічні змінні; решта — вручну |
| Виклик інших кейсів, `gotoStep`, HTTP-клієнт, крипто, Groovy SQL | 0 | — | — |

**Типовий шаблон (~60% Groovy-кроків)**, наприклад `SetupTestSuiteProperties`:
```groovy
response = testRunner.testCase.getTestStepByName("JDBC_GetTestSuiteProperties").getResponseContent()
response_as_xml = new GroovyUtils(context).getXmlHolder(response)
testRunner.testCase.testSuite.setPropertyValue("MicromarketId", response_as_xml.getNodeValue("//MICROMARKETID"))
```
→ автоматично конвертується в екстрактори SQL-кроку `JDBC_GetTestSuiteProperties`:
```yaml
extract:
  - { variable: MicromarketId, scope: suite, source: { kind: dbCheck, path: "rows[0].MICROMARKETID" } }
```
Конвертер (задача P5-4.4) розпізнає цей шаблон регулярними виразами/AST-light парсингом, включно з варіантом «map колонка → властивість + цикл». Ціль — ≥ 70% Groovy-кроків без ручної роботи.

## 7.6 Змінні (property expansions)

| Вид | Використань | API-Pulse |
|-----|-------------|-----------|
| `${#TestSuite#X}` | 3 518 | suite-змінні (спільні між сценаріями suite) |
| `${X}` (глобальні з settings) | 3 199 | Globals / Environment |
| `${#Project#X}` | 1 610 | Environment |
| `${#TestCase#X}` | 419 | змінні сценарію |
| `${Step#Prop}` | 6 | `{ kind: step, ... }` |

Головний висновок: **тест-кейси в suite залежні** — перший готує дані й кладе їх у TestSuite properties, наступні використовують. Модель сценаріїв це підтримує через `scope: suite`, `runMode: sequential` і `dependsOn` (06-scenarios §6.4 п.9).

## 7.7 Що це змінює в плані

1. **Пріоритет СУБД:** MS SQL Server — перший драйвер (Фаза 3 починається з нього), далі Cosmos DB, потім Postgres/MySQL.
2. **Suite-змінні та залежні сценарії** — в MVP (без них імпорт не працюватиме).
3. **Динамічний хост БД** і пули за резолвленими параметрами — в MVP.
4. **Імпорт SoapUI** — фактично Must для команди: без нього 1 672 кроки доведеться переносити вручну. Залишено в Should лише формально, реалізація — у Фазі 5.
5. **Автоприбирання (cleanup)** — нова цінність: зараз тести лише додають дані (`if not exists insert`), прибирання немає.
6. **Mock-сервіси** — після MVP; SoapUI MockServices продовжують працювати через `Runners/*.bat`.
7. **REST-фокус**: 55% кроків — REST з JSON. Якість JSON-редактора, JSONPath-автодоповнення і контекстних дій «Extract/Assert from response» важливіша за WSDL-генератор.

## 7.8 Відкриті питання

- Чи використовується `soapui-settings.xml` лише для глобальних властивостей (connection strings, драйвер), чи там є ще щось важливе (SSL-сертифікати, проксі)? Для імпорту достатньо знати **імена** глобальних властивостей — значення користувач введе в Environment.
- Mock-сервіси: чи потрібні вони в CI-пайплайні (тоді заміна важливіша), чи лише для локальної розробки?
