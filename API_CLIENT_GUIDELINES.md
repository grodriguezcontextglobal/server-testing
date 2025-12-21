# Server-Side Safeguards & Client-Side Guidelines

To ensure maximum server stability and avoid downtime, we have implemented several safeguards on the backend. The client-side application must adhere to the following guidelines to interact effectively with the server.

## 1. Rate Limiting
The server now enforces a global rate limit to prevent abuse and resource exhaustion.
- **Limit**: 300 requests per 15 minutes per IP address.
- **Client Action**: 
  - Handle `429 Too Many Requests` responses gracefully.
  - Implement exponential backoff for retries when receiving a 429 error.
  - Avoid polling endpoints too frequently.

## 2. Request Timeouts
To prevent connection leaks, the server enforces a strict timeout on all requests.
- **Timeout**: 30 seconds.
- **Client Action**:
  - If a request takes longer than 30 seconds, the server will respond with `408 Request Timeout`.
  - Ensure the client has its own timeout configuration (e.g., in Axios or Fetch) to match or slightly exceed this limit.
  - For long-running operations (like large file uploads), ensure they are broken into chunks or use the specific bulk endpoints configured for larger payloads.

## 3. Payload Size Limits
To prevent memory exhaustion, request body sizes are limited.
- **Standard Limit**: 50MB for most endpoints.
- **Bulk Operation Limit**: 100MB for specific high-volume routes.
- **Client Action**:
  - Do not send payloads larger than 50MB to standard endpoints.
  - If you need to upload large files or datasets, verify you are using the correct "bulk" endpoint or split the data into smaller chunks.

## 4. Security Headers
The server now uses `Helmet` to set various security headers (e.g., HSTS, X-Frame-Options).
- **Client Action**:
  - Ensure your client respects these headers (e.g., not trying to iframe the API if forbidden).
  - Cross-Origin Resource Sharing (CORS) is configured; ensure your client's origin is whitelisted in the server configuration.

## 5. Error Handling
The server has enhanced global error handling, including automatic catching of asynchronous errors.
- **Client Action**:
  - Always check the `ok` field in the JSON response.
  - If `ok: false`, display the `msg` to the user or log it for debugging.
  - Common error codes to handle:
    - `400`: Bad Request (Invalid input).
    - `401`: Unauthorized (Invalid/Missing Token).
    - `403`: Forbidden (Insufficient Permissions/MFA required).
    - `404`: Not Found.
    - `408`: Timeout.
    - `429`: Rate Limit Exceeded.
    - `500`: Internal Server Error.

## 6. Input Validation
While the server validates inputs, the client should perform preliminary validation.
- **Client Action**:
  - Validate required fields (email, passwords, IDs) before sending requests.
  - Ensure data types match expected schema (e.g., numbers are not strings).

## Summary of Server Changes
- Installed `express-async-errors` to prevent server crashes from unhandled async rejections.
- Installed `helmet` for security headers.
- Installed `express-rate-limit` for traffic control.
- Added global timeout middleware.
