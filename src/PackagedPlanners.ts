/*
 * Copyright (c) Jan Dolejsi 2022. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 */
'use strict';

import { URL } from 'url';
import { getJson } from './httpUtils';

/** See https://github.com/AI-Planning/planning-as-a-service/issues/32 */
export class PackagedPlanners {
    constructor(private readonly packageUrl: URL) {

    }

    async getManifests(): Promise<PackageManifest[]> {
        return getJson(this.packageUrl);
    }
}

/** Describes returned data structure. */
export interface PackageManifest {
    description: string | undefined;
    package_name: string | undefined;
    name: string;
    endpoint: {
        services: { [key: string]: EndpointService }
    };
    runnable: boolean;
    "install-size": string;
    dependencies: string[];
}

export interface EndpointService {
    args: EndpointServiceArgument[];
    call: string; // irrelevant for remote calling
    return: {
        files: string,
        type: string
    }; // irrelevant for remote calling
}

export interface EndpointServiceArgument {
    name: "domain" | "problem" | string;
    description: string;
    type: "file" | "int" | "categorical";
    default?: string | number | boolean;
    /** Only if type is 'categorical' */
    choices?: EndpointServiceArgumentChoice[];
}

export interface EndpointServiceArgumentChoice {
    display_value: string;
    value: string | number | boolean;
}