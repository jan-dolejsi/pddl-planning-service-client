/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi 2022. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

const HTTPS = "https:";

function get(url: URL, callback?: ((res: http.IncomingMessage) => void) | undefined): http.ClientRequest {
    return url.protocol === HTTPS ? https.get(url, callback) : http.get(url, callback);
}

function request(url: URL, options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void): http.ClientRequest {
    return url.protocol === HTTPS ? https.request(url, options, callback) : http.request(url, options, callback);
}

export async function getJson<T>(url: URL): Promise<T> {
    return await new Promise((resolve, reject) => {
        get(url, res => {
            if (res.statusCode && res.statusCode >= 300) {
                reject(new Error(`Status code ${res.statusCode}, ${res.statusMessage} from ${url}`));
                res.resume();
                return;
            }
            const contentType = res.headers['content-type'];
            if (!contentType || !/^application\/json/.test(contentType)) {
                reject(new Error('Invalid content-type.\n' +
                    `Expected application/json but received ${contentType} from ${url}`));
                res.resume();
                return;
            }
            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(rawData);
                    // console.log(parsedData);
                    resolve(parsedData);
                } catch (e: unknown) {
                    console.error(e);
                    reject(e);
                }
            });
        });
    });
}

export interface PostOptions extends https.RequestOptions {
    /** Response body should be parsed as JSON input. */
    json?: boolean;
    /** Response body should be read using given encoding. */
    encoding?: string;
    isAuthenticated?: boolean;
    serviceFriendlyName?: string;
    verbose?: boolean;
}

export function postJsonAsString(url: URL, requestBody: never, options: PostOptions): Promise<string> {
    options.json = false;
    return postJson<string>(url, requestBody, options);
}

export async function postJson<T>(url: URL, requestBody: never, options: PostOptions): Promise<T> {
    const requestData = JSON.stringify(requestBody);
    options.headers = Object.assign(options.headers, {
        'Content-Type': 'application/json',
        'Content-Length': requestData.length,
    });

    return await new Promise((resolve, reject) => {
        const from = options.serviceFriendlyName ?? url;
        options.method = 'POST';
        const req = request(url, options, res => {
            if (res.statusCode && res.statusCode > 202) {
                let message: string;
                if (options.isAuthenticated && res.statusCode === 400) {
                    message = `Authentication failed. Please login or update tokens. (${from})`;
                }
                else if (options.isAuthenticated && res.statusCode === 401) {
                    message = `Invalid token. Please update tokens. (${from})`;
                }
                else {
                    message = `${from} returned code ${res.statusCode} ${res.statusMessage}`;
                }
                reject(new Error(message));
                res.resume();
                return;
            }
            if (options.json) {
                const contentType = res.headers['content-type'];
                if (!contentType || !/^application\/json/.test(contentType)) {
                    reject(new Error('Invalid content-type.\n' +
                        `Expected application/json but received ${contentType} from ${url}`));
                    res.resume();
                    return;
                }
            }
            res.on('error', error => {
                reject(error);
            });
            res.setEncoding((options.encoding as BufferEncoding) ?? 'utf8');
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                if (options.json) {
                    try {
                        const parsedData = JSON.parse(rawData);
                        options.verbose && console.log(parsedData);
                        resolve(parsedData);
                    } catch (e: unknown) {
                        console.error(e);
                        reject(e);
                    }
                } else {
                    resolve(rawData as unknown as T);
                }
            });
        });
        req.on('error', error => {
            reject(error);
        });
        req.write(requestData);
        req.end();
    });
}
