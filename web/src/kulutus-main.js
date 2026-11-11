import { mount } from 'svelte';
import './app.css';
import Kulutus from './Kulutus.svelte';

export default mount(Kulutus, { target: document.getElementById('app') });
