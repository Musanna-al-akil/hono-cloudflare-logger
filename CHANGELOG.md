# Changelog

All notable changes to this project will be documented in this file.

This project follows [Changesets](https://github.com/changesets/changesets) for versioning and changelog updates.

## Unreleased

## 0.1.0-beta.0 - 2026-02-26

### Initial beta launch

- Introduced Cloudflare Workers-first structured logging middleware for Hono.
- Added NDJSON output with newline-terminated log entries and severity-based console routing.
- Added request metadata controls (`trace_id`, allowlisted `req.cf`, optional request headers).
- Added deep key redaction hooks for nested objects and arrays.
- Added minimal and advanced usage examples plus test coverage.
