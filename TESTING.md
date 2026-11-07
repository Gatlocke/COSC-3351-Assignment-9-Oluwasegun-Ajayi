# Assignment 9 — Testing Evidence

Captured: 2026-11-07T05:35:13.339Z (UTC)  
Runtime: Node v24.20.0  
Database: PostgreSQL, table `assignment9.items`  
Result: **15 actual HTTP checks passed**, plus an independent SQL check and two actual process restarts.

## Evidence method

These results were captured on the local Mac by `npm run evidence`, using
Node's HTTP client against a real Express server and PostgreSQL database.
No connection credentials are included.

`requests.http` contains the corresponding requests for VS Code REST Client.
The completed client response captures are documented separately from this
automated run in the supporting evidence below. Each test run generates its
own IDs, so the automated transcript may use different IDs from the manual
captures.

## Supporting evidence

- [REST Client response evidence](evidence/CLIENT-RESULTS.md): all eight
  verified response screenshots, including persistence after restart.
- [Mac automated test results](evidence/MAC-TESTS.md): 15 tests passed,
  zero failures, and the evidence-generation confirmation screenshots.
- [Local Mac setup verification](evidence/SETUP.md): installation, database
  setup, startup output, and the Terminal restart capture.

These supporting files and screenshots in `evidence/` are preserved when
`npm run evidence` regenerates this report.

## Endpoint summary

| Operation | Route | Observed status |
| --- | --- | --- |
| Retrieve collection | GET /api/items | 200 |
| Retrieve saved item | GET /api/items/:id | 200 |
| Insert item | POST /api/items | 201 |
| Update item | PUT /api/items/:id | 200 |
| Delete item | DELETE /api/items/:id | 200 |
| Target missing item | GET/PUT/DELETE /api/items/:id | 404 |
| Reject invalid input | POST /api/items or PUT /api/items/:id | 400 |

IDs and ports below are actual values from this run and will differ on a
new run. Tests only delete records they create; pre-existing data is not
cleared. For setup, see README.md. To repeat: `npm test` and `npm run evidence`.

## 1. POST creates a database row

Request/query executed:

```text
POST http://localhost:60349/api/items
Content-Type: application/json

{"title":"Review database-backed endpoints","completed":false}
```

Observed response:

```text
HTTP 201 Created
Content-Type: application/json; charset=utf-8
Location: /api/items/19

{
  "id": 19,
  "title": "Review database-backed endpoints",
  "completed": false
}
```

## 2. GET collection includes the saved row

Request/query executed:

```text
GET http://localhost:60349/api/items
```

Observed response:

```text
HTTP 200 OK
Content-Type: application/json; charset=utf-8

[
  {
    "id": 19,
    "title": "Review database-backed endpoints",
    "completed": false
  }
]
```

## 3. GET finds the database-generated ID

Request/query executed:

```text
GET http://localhost:60349/api/items/19
```

Observed response:

```text
HTTP 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": 19,
  "title": "Review database-backed endpoints",
  "completed": false
}
```

## 4. PUT updates the row without changing its ID

Request/query executed:

```text
PUT http://localhost:60349/api/items/19
Content-Type: application/json

{"title":"Finish database-backed endpoints","completed":true}
```

Observed response:

```text
HTTP 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": 19,
  "title": "Finish database-backed endpoints",
  "completed": true
}
```

## 5. Independent SQL read confirms the updated row

Request/query executed:

```text
SELECT id, title, completed FROM assignment9.items WHERE id = $1
Bound parameter: 19
```

Observed response:

```text
[
  {
    "id": 19,
    "title": "Finish database-backed endpoints",
    "completed": true
  }
]
```

## 6. Actual process restart

Stopped server.js and started a new Node process using the same database. No schema setup or reinsertion was performed.

## 7. GET after restart returns the same saved values

Request/query executed:

```text
GET http://localhost:60349/api/items/19
```

Observed response:

```text
HTTP 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": 19,
  "title": "Finish database-backed endpoints",
  "completed": true
}
```

## 8. Blank title is rejected

Request/query executed:

```text
POST http://localhost:60349/api/items
Content-Type: application/json

{"title":"   "}
```

Observed response:

```text
HTTP 400 Bad Request
Content-Type: application/json; charset=utf-8

{
  "error": "title must be a non-empty string of at most 120 characters."
}
```

## 9. Malformed JSON is rejected

Request/query executed:

```text
POST http://localhost:60349/api/items
Content-Type: application/json

{"title":
```

Observed response:

```text
HTTP 400 Bad Request
Content-Type: application/json; charset=utf-8

{
  "error": "Invalid JSON body."
}
```

## 10. ID replacement is rejected

Request/query executed:

```text
PUT http://localhost:60349/api/items/19
Content-Type: application/json

{"id":42,"title":"Do not save"}
```

Observed response:

```text
HTTP 400 Bad Request
Content-Type: application/json; charset=utf-8

{
  "error": "id is generated by the database and cannot be supplied or changed."
}
```

## 11. Rejected update left the saved row unchanged

Request/query executed:

```text
GET http://localhost:60349/api/items/19
```

Observed response:

```text
HTTP 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": 19,
  "title": "Finish database-backed endpoints",
  "completed": true
}
```

## 12. DELETE removes the row

Request/query executed:

```text
DELETE http://localhost:60349/api/items/19
```

Observed response:

```text
HTTP 200 OK
Content-Type: application/json; charset=utf-8

{
  "message": "Item deleted.",
  "item": {
    "id": 19,
    "title": "Finish database-backed endpoints",
    "completed": true
  }
}
```

## 13. GET deleted ID returns 404

Request/query executed:

```text
GET http://localhost:60349/api/items/19
```

Observed response:

```text
HTTP 404 Not Found
Content-Type: application/json; charset=utf-8

{
  "error": "Item not found."
}
```

## 14. PUT deleted ID returns 404

Request/query executed:

```text
PUT http://localhost:60349/api/items/19
Content-Type: application/json

{"title":"Missing"}
```

Observed response:

```text
HTTP 404 Not Found
Content-Type: application/json; charset=utf-8

{
  "error": "Item not found."
}
```

## 15. DELETE deleted ID returns 404

Request/query executed:

```text
DELETE http://localhost:60349/api/items/19
```

Observed response:

```text
HTTP 404 Not Found
Content-Type: application/json; charset=utf-8

{
  "error": "Item not found."
}
```

## 16. Second actual process restart

Restarted the API again without changing PostgreSQL, to check that the deletion is permanent.

## 17. Deleted row remains absent after restart

Request/query executed:

```text
GET http://localhost:60349/api/items/19
```

Observed response:

```text
HTTP 404 Not Found
Content-Type: application/json; charset=utf-8

{
  "error": "Item not found."
}
```

## 18. Final collection does not contain the deleted item

Request/query executed:

```text
GET http://localhost:60349/api/items
```

Observed response:

```text
HTTP 200 OK
Content-Type: application/json; charset=utf-8

[]
```

## Captured server logs

```text
Assignment 9 API listening on http://localhost:60349
Storage: PostgreSQL assignment9.items. Data survives API restarts.
[2026-11-07T05:35:13.091Z] POST /api/items
[2026-11-07T05:35:13.102Z] GET /api/items
[2026-11-07T05:35:13.104Z] GET /api/items/19
[2026-11-07T05:35:13.107Z] PUT /api/items/19

--- new API process ---
Assignment 9 API listening on http://localhost:60349
Storage: PostgreSQL assignment9.items. Data survives API restarts.
[2026-11-07T05:35:13.220Z] GET /api/items/19
[2026-11-07T05:35:13.223Z] POST /api/items
[2026-11-07T05:35:13.227Z] POST /api/items
[2026-11-07T05:35:13.230Z] PUT /api/items/19
[2026-11-07T05:35:13.231Z] GET /api/items/19
[2026-11-07T05:35:13.234Z] DELETE /api/items/19
[2026-11-07T05:35:13.237Z] GET /api/items/19
[2026-11-07T05:35:13.239Z] PUT /api/items/19
[2026-11-07T05:35:13.241Z] DELETE /api/items/19

--- new API process ---
Assignment 9 API listening on http://localhost:60349
Storage: PostgreSQL assignment9.items. Data survives API restarts.
[2026-11-07T05:35:13.333Z] GET /api/items/19
[2026-11-07T05:35:13.336Z] GET /api/items
```
