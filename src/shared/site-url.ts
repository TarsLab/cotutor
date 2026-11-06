/** 地址:默认端口不写(https 的 443、http 的 80)。不用 new URL:它会把主机名压成小写 */
export function siteUrl(scheme: 'http' | 'https', host: string, port: number, path = '/'): string {
  const isDefault = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80);
  return `${scheme}://${host}${isDefault ? '' : `:${port}`}${path}`;
}
