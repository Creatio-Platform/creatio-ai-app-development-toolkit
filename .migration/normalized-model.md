# Phase 0 — Нормалізована модель (спільна мова рушія)

Статус: **на затвердження (перед кодом)** · Частина [`solution-design.md`](solution-design.md)

Це контракт даних, яким обмінюються всі компоненти Шару 2. Мета — зафіксувати структури й enum-декоди до написання коду, щоб merge, mapper і скіл говорили однією мовою. Формат нижче — псевдо-типи (реалізація — TS/JSON-schema на етапі Ф2).

## 1. Потік даних
```
RawLayer[]  --parser-->  ParsedLayer[]  --merge-->  EffectiveClassicPage  --mapper-->  FreedomChangeSet
                                          (graph)-->  MigrationUnit
```

## 2. Вхід
```
RawLayer        { schemaName, schemaUId, package, maintainer, isClientEditable,
                  isBase (ExtendParent=false), baseTemplate (Parent.Name), body:string }
ParsedLayer     { entitySchemaName, diffOps: DiffOp[], businessRules: RawRule[],
                  rules: RawRule[], attributes:{name→AttrSpec}, details:{key→DetailSpec},
                  methods:{name→MethodSpec}, messages, mixins, properties, resources }
DiffOp          { operation: insert|merge|move|remove, name,
                  parentName?, propertyName? ("items"|"tabs"), index?, values?:raw }
```

## 3. Нормалізовані структури (вихід merge)
```
Provenance      { layers:[{package, maintainer, isClientEditable, diffOpIndex?}],
                  origin: base | clientDelta | mixed }
State           bool | { conditionRef }            // статичне або кероване правилом
NormalizedField { name, column, controlType, caption,
                  layout:{column,row,colSpan,rowSpan}, container, tab,
                  states:{visible:State, enabled:State, required:State, readonly:State},
                  provenance }
NormalizedContainer { name, kind: grid|flex|group|tab|tabpanel|container,
                  caption?, parent, layout, children:[name], provenance }
NormalizedDetail { key, detailSchema, entity, masterColumn, detailColumn,
                  columns?[], filterMethod?, container, tab,
                  pages?: MigrationUnit,           // рекурсія (заповнює graph resolver)
                  provenance }
NormalizedRule  { id, kind: bind|filter, attribute, enabled, removed,
                  // bind:
                  property?: visible|enabled|required|readonly, conditions?: Condition[],
                  // filter:
                  filterColumn?, comparison?, value?|valueRef?, autocomplete?, autoClean?,
                  provenance }
Condition       { left:{kind:attribute, path}, comparison,
                  right:{kind:const|attribute|syssetting, value?|path?, dataValueType} }
NormalizedMethod{ name, category, body, overrideChain:[package], callsParent, provenance }
NormalizedComponent { name, kind: chart|indicator|dashboard|actionDashboard|customModule|other,
                  config:raw, provenance }          // B9/B10 — не-полеві віджети
NormalizedButton{ name, caption, action:{kind, ref}, provenance }
EffectiveClassicPage {
    schemaName, role: PageRole, entity,
    tree,                                   // корінь → вкладені контейнери
    tabs[], fields[], containers[], details[], rules[], methods[],
    components[], buttons[], removed[],     // tombstoned (з provenance видаляча)
    resources, provenance }
```
`PageRole = list | record | typedRecord | miniAdd | lookup | detail`

## 4. Граф ролей (вихід graph resolver)
```
MigrationUnit {
    entity, entityLayers:[{package, editable}],
    classic: { sections[], listPage?, editPages:[{role, typeValue?, schema}], miniPages:[{schema, modes}] },
    details: [{ caption, detailSchema, entity, masterColumn, pages: MigrationUnit }],  // рекурсія
    freedom: { listPage?, formPage?, miniPages[] },
    targetPackage }                          // client-editable
```

## 5. Вихід mapper
```
FreedomChangeSet {
    pageSchemaName, targetPackage, template, strategy: reconcile|build,
    viewConfigDiff[], viewModelConfigDiff[], modelConfigDiff[],
    pageBusinessRules[], entityBusinessRules[],   // + завжди зворотні
    handlerStubs:[{request, sourceMethod, draft}],
    relatedPageBindings[], resources,
    needsDecision:[{kind, item, reason, suggestion}] }
```

## 6. Enum-декоди (з розвідки; ⚠ = звірити з Terrasoft-енумом при реалізації)
| Enum | Значення |
|---|---|
| `itemType` | 0=GRID_LAYOUT, 2=DETAIL, 15=CONTROL_GROUP; CONTAINER (символьно) |
| `contentType` | LOOKUP=5 (перевірено); ENUM/RICH_TEXT (символьно); 3=text/display ⚠ звірити 4 vs 5 |
| `ruleType` | 0=BINDPARAMETER, 1=FILTRATION |
| `property` (bind) | 0=VISIBLE, 1=ENABLED, 2=REQUIRED, 3=READONLY |
| `type`/valueType | 0=CONSTANT, 1=ATTRIBUTE, 2=SYSSETTING |
| `comparisonType` | 3=EQUAL; решта через Terrasoft.ComparisonType ⚠ |
| `dataValueType` | 1=TEXT, 10=LOOKUP, 12=BOOLEAN; решта ⚠ |

## 7. Нормалізація типу контролю (Classic → controlType → Freedom)
| Classic (bindTo/contentType/generator) | controlType | Freedom |
|---|---|---|
| текстова колонка, без contentType | text | crt.Input |
| довгий текст | memo | crt.Input(multiline) |
| RICH_TEXT | richtext | crt.RichTextEditor |
| LOOKUP / ENUM | lookup | crt.ComboBox |
| дата/дата-час/час | date/datetime/time | crt.DateTimePicker(pickerType) |
| Integer/Float | integer/float | crt.NumberInput |
| Money (`MultiCurrencyEditViewGenerator`) | money | crt.NumberInput |
| Boolean | boolean | crt.Checkbox |
| Phone/Email/Web | phone/email/web | crt.PhoneInput/EmailInput/WebInput |
| Image/File | image/file | crt.ImageInput/FileInput |
| CONTROL_GROUP | container:group | crt.ExpansionPanel / crt.GridContainer |
| GRID_LAYOUT | container:grid | crt.GridContainer |
| CONTAINER | container:flex | crt.FlexContainer |
| Tab у `tabs` | container:tab | crt.TabPanel + crt.TabContainer |
| DETAIL | detail | «Expanded list» композит |

## 8. Фікстури (golden)
- **Пілот:** [`fixtures/supportunitemployee/`](fixtures/supportunitemployee/) — `SupportCalendar_base.js` (base, 27 inserts, деталі `SupportScheduleEmployeeDetail`/`SupportUnitLogDetail`/`SupportScheduleLogDetail`, метод `setName`) + `SupportService.js` (override, тонкий). Сутність `SupportUnit`. Очікувана ефективна модель дописується як `expected.md` під час Ф2.
- **Складний еталон:** [`fixtures/contract/`](fixtures/contract/) — 9 шарів `ContractPageV2`. Очікуване (з розвідки): таби GeneralInfo/Passport/SaaSMetrics/History/Visa/NotesFiles; прибрано `State`,`Contact`; правила `Owner`(FILTRATION)+`Parent`(REQUIRED-if-`Type.IsSlave`) у WorkContractsProcess; деталі Product/Visa/Invoice/Document/SubordinateContracts.

## 9. Питання до затвердження
1. Склад нормалізованих структур (§3–§5) — достатній для всіх кейсів B1–B10, чи чогось бракує?
2. `State` як `bool | {conditionRef}` (правило посилається на поле, а не інлайн-умова в полі) — ок?
3. Provenance на рівні елемента (layer+package+editable+diffOpIndex) — достатньо для A3.1/B6?
4. Enum-декоди з ⚠ фіналізуємо на Ф2 читанням Terrasoft-енумів зі стенду — прийнятно?
