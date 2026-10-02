import createClient from "openapi-fetch";
import type { paths } from "./schema";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = createClient<paths>({ baseUrl: API_URL });
