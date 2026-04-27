# UsersAgent

A tiny directory of users, stored in agent state. Demonstrates the
`@callable` JSDoc convention — every public RPC method gets a tag so
the catalog endpoint can advertise it.

## Callable methods

| Method | Signature | Description |
|---|---|---|
| `getUser`    | `(id: string) => Promise<User \| null>` | Look up a single user by id. |
| `listUsers`  | `() => Promise<User[]>`                  | Return every user. |
| `createUser` | `(name: string) => Promise<User>`        | Append a new user. |

## Type

```ts
type User = { id: string; name: string };
```

## HTTP

`GET /users/<instance>` returns `{ instance, users }`.
