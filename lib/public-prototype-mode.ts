export function isPublicPrototypeMode(): boolean {
  return process.env.NEXT_PUBLIC_PROTOTYPE_MODE === 'true';
}
