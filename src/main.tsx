import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { seedDefaultInventoryData } from './lib/seedData';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void seedDefaultInventoryData().catch(err => {
  console.error('Inventory seed failed:', err);
});
