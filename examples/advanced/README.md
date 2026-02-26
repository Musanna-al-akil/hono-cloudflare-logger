# Advanced Example

## Run

```bash
cd examples/advanced
npm install
npm run dev
```

### Endpoints

- `GET /health`
- `POST /login`

`POST /login` body example:

```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

Use `fail@example.com` to trigger unhandled error logging.
