# Savvagent Node.js Backend Example

Example Node.js/Express backend demonstrating how to use the Savvagent SDK in a server environment.

## Features

- Express.js server
- Feature-gated API endpoints
- Caching for improved performance
- Error handling examples
- TypeScript support

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```bash
   PORT=3000
   SAVVAGENT_API_URL=http://localhost:8080
   SAVVAGENT_SDK_KEY=your-sdk-key-here
   ```

3. **Run the server:**
   ```bash
   # Development with watch mode
   pnpm dev

   # Production
   pnpm start
   ```

## API Endpoints

### Health Check

```bash
GET /health
```

Returns server status.

### Get User Features

```bash
GET /api/features/:userId
```

Returns all feature flags for a user.

Example response:
```json
{
  "userId": "user-123",
  "features": {
    "newUI": true,
    "betaFeatures": false,
    "advancedAnalytics": true
  }
}
```

### Process Data (Feature-Gated)

```bash
POST /api/data
Content-Type: application/json

{
  "userId": "user-123",
  "data": {...}
}
```

Uses the `advanced-processing` flag to determine processing method.

## Usage Examples

### Check Feature Flag

```typescript
const isEnabled = await savvagent.isEnabled('new-feature', {
  userId: 'user-123',
  attributes: {
    userAgent: req.headers['user-agent'],
  },
});
```

### Feature-Gated Endpoint

```typescript
app.get('/api/endpoint', async (req, res) => {
  const useNewVersion = await savvagent.isEnabled('new-endpoint', {
    userId: req.userId,
  });

  if (useNewVersion) {
    // New implementation
  } else {
    // Old implementation
  }
});
```

### Batch Evaluation

```typescript
const [flag1, flag2, flag3] = await Promise.all([
  savvagent.isEnabled('flag-1', { userId }),
  savvagent.isEnabled('flag-2', { userId }),
  savvagent.isEnabled('flag-3', { userId }),
]);
```

## Learn More

- [Express Documentation](https://expressjs.com/)
- [Savvagent SDK Documentation](../../packages/typescript/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
