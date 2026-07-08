import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xadrez da Equipe",
  description: "Entre na fila e jogue xadrez com o time.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
