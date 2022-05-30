/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi 2022. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { get } from 'http';
import { URL } from 'url';

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
