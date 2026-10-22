import { createDatabase } from './db';
export default async function setup(): Promise<void> { await createDatabase(); }
