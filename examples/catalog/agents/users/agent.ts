import { Agent } from "agents";

type Env = Record<string, never>;
type User = { id: string; name: string };
type State = { users: User[] };

/**
 * UsersAgent stores a directory of users. Methods marked `@callable`
 * appear in the agent catalog at `/__ayjnt/catalog` so other agents
 * (and external tooling) can discover the RPC surface without reading
 * source.
 */
export default class UsersAgent extends Agent<Env, State> {
  override initialState: State = {
    users: [{ id: "u_1", name: "Ada" }, { id: "u_2", name: "Grace" }],
  };

  /**
   * Look up a single user by id.
   * @callable
   */
  async getUser(id: string): Promise<User | null> {
    return this.state.users.find((u) => u.id === id) ?? null;
  }

  /**
   * Return every user in the directory.
   * @callable
   */
  async listUsers(): Promise<User[]> {
    return this.state.users;
  }

  /**
   * Append a new user. Returns the freshly created record.
   * @callable
   */
  async createUser(name: string): Promise<User> {
    const user: User = { id: `u_${this.state.users.length + 1}`, name };
    this.setState({ users: [...this.state.users, user] });
    return user;
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
