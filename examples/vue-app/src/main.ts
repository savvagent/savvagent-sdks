import { createApp } from 'vue';
import { createSavvagent } from '@savvagent/vue';
import App from './App.vue';
import './style.css';

const app = createApp(App);

app.use(
  createSavvagent({
    apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL || 'http://localhost:8080',
    sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY || 'your-sdk-key',
    environment: 'development',
  })
);

app.mount('#app');
