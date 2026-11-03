// "Import a fixture file": GDTF (.gdtf), QLC+ (.qxf) or an Open Fixture Library JSON (.json),
// whatever the user downloaded from a manufacturer or made in another tool.
import type { FixtureType } from '../model/types';
import { fromGdtf } from './gdtf';
import { fromQxf } from './qxf';
import { fromOfl } from './ofl';

export async function importFixtureFile(file: File): Promise<FixtureType> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.gdtf')) return fromGdtf(new Uint8Array(await file.arrayBuffer()), file.name);
  const text = await file.text();
  if (name.endsWith('.qxf') || text.trimStart().startsWith('<')) return fromQxf(text, file.name);
  let j: { name?: string; modes?: unknown };
  try { j = JSON.parse(text); } catch { throw new Error('not a fixture file (GDTF, QLC+ .qxf or Open Fixture Library .json)'); }
  if (!j.name || !Array.isArray(j.modes)) throw new Error('this JSON is not an Open Fixture Library fixture');
  const key = `user/${file.name.replace(/\.json$/i, '')}`;
  return { ...fromOfl(key, j, 'Imported'), source: 'user', ref: file.name };
}
