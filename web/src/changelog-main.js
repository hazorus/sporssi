import { mount } from 'svelte';
import './app.css';
import Changelog from './Changelog.svelte';

export default mount(Changelog, { target: document.getElementById('app') });
