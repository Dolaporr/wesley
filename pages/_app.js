// pages/_app.js
import "../styles/globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}