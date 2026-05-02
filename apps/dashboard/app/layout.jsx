import "./globals.css";

export const metadata = {
  title: "EvoYield Allocation Dashboard",
  description: "Fresh allocation and rebalance dashboard for EvoYield KeeperHub executions.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
