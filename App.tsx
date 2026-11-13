import React, { useState } from 'react';
import LoginScreen from './src/screens/LoginScreen';
import { PoznoteClient } from './src/api';

export default function App() {
  const [client, setClient] = useState<PoznoteClient | null>(null);
  return <LoginScreen onConnected={setClient} />;
}
