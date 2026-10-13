// Below the area's layout on purpose: the layout's session check finishes before anything streams, so a signed-out
// visitor gets a real 307 to /login (a loading boundary above the layout turns redirects into client-side ones).
export { Loading as default } from '../../../components/shell/Loading';
