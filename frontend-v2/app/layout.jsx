import './globals.css'

export const metadata = {
  title: 'African Robot — Dashboard',
  description: 'Robot compagnon IA avec visage africain animé',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="bg-surface min-h-screen">
        {children}
      </body>
    </html>
  )
}
