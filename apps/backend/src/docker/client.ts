import Docker from 'dockerode';
import { config } from '../config.js';

export const docker = new Docker({ socketPath: config.dockerSocketPath });
