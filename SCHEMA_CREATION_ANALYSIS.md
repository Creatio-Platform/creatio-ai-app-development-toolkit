# Аналіз створення схем у Creatio - Результати

## 📋 Загальна інформація
- **Дата тестування:** 18 лютого 2026
- **Creatio URL:** http://ts1-infr-web01:88/studioenu_14225044_0218
- **Метод тестування:** Аналіз network requests у Page Designer

## ✅ Робочий процес створення схеми

### Етап 1: Аутентифікація
```
POST /ServiceModel/AuthService.svc/Login
Body: { "UserName": "Supervisor", "UserPassword": "Supervisor" }
```
**Результат:** ✅ Успішно

### Етап 2: Отримання Package UID
```
POST /0/ServiceModel/ApplicationPackagesService.svc/GetDesignPackageUId
Body: { "userLevelSchema": false }
```
**Результат:** ✅ Package UID: `a00051f4-cde3-4f3f-b08e-c5ad1a5c735a`

### Етап 3: Створення схеми (ПРАВИЛЬНИЙ МЕТОД!)
```
POST /0/ServiceModel/ClientUnitSchemaDesignerService.svc/CreateNewSchema
Body: {
  "packageUId": "a00051f4-cde3-4f3f-b08e-c5ad1a5c735a",
  "schemaType": 9,  // 9 = AngularSchema (ClientUnit)
  "userLevelSchema": false
}
```
**Результат:** ✅ Schema створена з auto-generated name `UsrClientUnit_XXXXXX`

### Етап 4: Застосування батьківської схеми
```
POST /0/ServiceModel/ClientUnitSchemaDesignerService.svc/ApplyParent
Body: {
  "newParentUid": "ec5fd902-66ce-4139-a241-10ebd8addc40",  // BasePageFreedomTemplate
  "clientUnitSchema": { /* schema object */ },
  "userLevelSchema": false
}
```
**Результат:** ✅ Parent успішно застосований

### Етап 5: Перевірка унікальності імені
```
POST /0/ServiceModel/ClientUnitSchemaDesignerService.svc/CheckUniqueSchemaName
Body: {
  "schemaName": "UsrClientUnit_XXXXXX",
  "packageUId": "a00051f4-cde3-4f3f-b08e-c5ad1a5c735a",
  "schemaUId": "..."
}
```
**Результат:** ✅ Перевірка виконується

### Етап 6: Збереження схеми
```
POST /0/ServiceModel/ClientUnitSchemaDesignerService.svc/SaveSchema
Body: { /* full schema object with body code */ }
```
**Результат:** ✅ Schema успішно збережена

## 🔑 Ключові знахідки

### 1. Правильний метод - `CreateNewSchema`
❌ **НЕ ПРАЦЮЄ:** `CreateSchema`
✅ **ПРАЦЮЄ:** `CreateNewSchema`

### 2. Правильна структура для ApplyParent
```javascript
// ❌ НЕПРАВИЛЬНО:
{
  schema: schemaObject,
  newParentUid: "...",
  userLevelSchema: false
}

// ✅ ПРАВИЛЬНО:
{
  newParentUid: "...",
  clientUnitSchema: schemaObject,
  userLevelSchema: false
}
```

### 3. Schema Type коди
- `9` = AngularSchema (ClientUnit / Page Schema)
- Інші типи потребують перевірки

### 4. Endpoint з префіксом `/0/`
Правильний URL: 
```
/0/ServiceModel/ClientUnitSchemaDesignerService.svc/CreateNewSchema
```

НЕ працює без `/0/`:
```
/ServiceModel/ClientUnitSchemaDesignerService.svc/CreateNewSchema  ❌
```

### 5. Auto-generated Schema Name
Creatio автоматично генерує унікальне ім'я з префіксом `Usr`:
```
UsrClientUnit_711671e
UsrClientUnit_15416f6
```

## 📊 Інші доступні методи

Знайдені в Page Designer:
1. ✅ `CreateNewSchema` - створення нової схеми
2. ✅ `GetParentSchemas` - отримання списку батьківських схем
3. ✅ `ApplyParent` - застосування батьківської схеми
4. ✅ `GetSchema` (AddonSchemaDesignerService) - отримання схеми
5. ✅ `GetSchemaMetadata` (AddonSchemaDesignerService) - отримання метаданих
6. ✅ `CheckUniqueSchemaName` - перевірка унікальності імені
7. ✅ `SaveSchema` - збереження схеми

## 🚀 Тестовий результат

Створена схема:
- **UID:** `c32818d3-4a79-4ecd-b393-06326c689f0b`
- **Name:** `UsrClientUnit_15416f6`
- **Type:** `9` (AngularSchema)
- **Parent:** `BasePageFreedomTemplate`
- **Package:** `Custom`

**URL у Creatio:**
```
http://ts1-infr-web01:88/studioenu_14225044_0218/0/ClientApp/#/SchemaDesigner/c32818d3-4a79-4ecd-b393-06326c689f0b
```

## 💡 Рекомендації для коду

### 1. Оновлено у `creatioMcpServer.ts`:
- Змінено `CreateSchema` на `CreateNewSchema`
- Виправлено параметри для `ApplyParent` (`clientUnitSchema` замість `schema`)

### 2. Оновлено у `env.ts`:
- Додано коментар про використання префіксу `/0/`

### 3. Створено робочий тест:
- `test-schema-creation-fixed.js` - повний робочий приклад

## 🎯 Висновки

✅ **Створення схем у Creatio працює!**

Основна проблема була в неправильному методі API:
- Використовувався `CreateSchema` (старий/неправильний метод)
- Потрібно використовувати `CreateNewSchema` (правильний метод)

Також важлива правильна структура параметрів для `ApplyParent`.

---

**Створено:** 2026-02-18
**Автор:** AI Analysis
