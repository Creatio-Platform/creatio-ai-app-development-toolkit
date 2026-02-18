# Creatio Schema Creator - Web UI

Simple web interface for creating Creatio schemas with natural language commands.

## Features

- 🎨 Beautiful, modern UI with gradient design
- 🇺🇦 Supports Ukrainian and English commands
- 🤖 AI-powered schema name extraction
- ✅ Real-time creation feedback
- 🔗 Direct links to created schemas in Creatio

## Usage

1. Start the server:
   ```bash
   npm start
   ```

2. Open browser at: http://localhost:3000

3. Enter a command like:
   - "створи схему з назвою MyPage"
   - "create schema named CustomerForm"
   - "зроби нову сторінку TestPage"

4. Click "Створити схему" button

5. Wait for the schema to be created

6. Click the link to open schema in Creatio

## Command Patterns

The UI automatically extracts schema name from various patterns:

```
з назвою MyPage        → MyPage
named TestForm         → TestForm
схему CustomerPage     → CustomerPage
create OrderList       → OrderList
```

If no name is found, it generates: `TestPage_<timestamp>`

## Technical Details

- Pure HTML/CSS/JavaScript (no frameworks)
- Fetch API for HTTP requests
- Responsive design
- Animated feedback
- Error handling with user-friendly messages

## Styling

- Gradient purple background
- White card container
- Smooth animations
- Mobile-friendly
- Auto-resizing textarea

## API Integration

Connects to `/agent/creatio/schema` endpoint:

```javascript
POST /agent/creatio/schema
{
  "action": "create",
  "schemaName": "ExtractedName",
  "schemaType": "AngularSchema",
  "description": "User command text"
}
```

## Error Handling

- Connection errors
- Server errors
- Failed schema creation
- All errors shown with clear messages
