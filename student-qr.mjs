import qrcode from './vendor/qrcode-generator.cjs';

export function studentQr(address) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || (url.search && url.search !== '?student=1') || url.hash || url.pathname !== '/') {
    throw new Error('Student QR codes require the HTTPS translator origin without credentials.');
  }
  const qr = qrcode(0, 'M');
  qr.addData(url.origin + '/?student=1', 'Byte');
  qr.make();
  return qr;
}

export function studentQrSvg(address) {
  return studentQr(address).createSvgTag({
    cellSize: 8,
    margin: 32,
    scalable: true,
    title: 'Scan to open student sign-in',
    alt: 'Opens the protected translator. Enter the class access code after scanning.',
  }).replace('<svg ', '<svg shape-rendering="crispEdges" ');
}
