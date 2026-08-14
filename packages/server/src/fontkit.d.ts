declare module 'fontkit' {
  export interface Font { characterSet: number[] }
  export function openSync(path: string): Font;
}
