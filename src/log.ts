export function info(message: string): void {
  console.log(message);
}

export function warn(message: string): void {
  console.warn(`::warning::${escapeCommandData(message)}`);
}

export function mask(value: string): void {
  if (value) {
    console.log(`::add-mask::${escapeCommandData(value)}`);
  }
}

export function error(message: string): void {
  console.error(`::error::${escapeCommandData(message)}`);
}

export function escapeCommandData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
