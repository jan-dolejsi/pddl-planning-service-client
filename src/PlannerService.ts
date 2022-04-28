/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as request from 'request';
import { planner, Plan, ProblemInfo, DomainInfo, parser, PlanStep } from 'pddl-workspace';


/** Abstract implementation of both sync/async planning service client. */
export abstract class PlannerService extends planner.Planner {

    constructor(plannerUrl: string, plannerConfiguration: planner.PlannerRunConfiguration, providerConfiguration: planner.ProviderConfiguration) {
        super(plannerUrl, plannerConfiguration, providerConfiguration);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abstract createRequestBody(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo): Promise<any>;

    abstract createUrl(): string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abstract processServerResponseBody(responseBody: any, planParser: parser.PddlPlannerOutputParser, parent: planner.PlannerResponseHandler,
        resolve: (plans: Plan[]) => void, reject: (error: Error) => void): void;

    async plan(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo, planParser: parser.PddlPlannerOutputParser, parent: planner.PlannerResponseHandler): Promise<Plan[]> {
        parent.handleOutput(`Planning service: ${this.plannerPath}\nDomain: ${domainFileInfo.name}, Problem: ${problemFileInfo.name}\n`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let requestHeader: any = {};
        if (this.plannerConfiguration.authentication?.getToken() !== undefined) {
            requestHeader = {
                "Authorization": "Bearer " + this.plannerConfiguration.authentication.getToken()
            };
        }

        // currently, this is used to notify any observers that planning is starting
        parent.providePlannerOptions({ domain: domainFileInfo, problem: problemFileInfo });

        const requestBody = await this.createRequestBody(domainFileInfo, problemFileInfo);
        if (!requestBody) { return []; }
        const url: string = this.createUrl();

        const timeoutInSec = this.getTimeout();

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this;
        return new Promise<Plan[]>(function (resolve, reject) {

            request.post({ url: url, headers: requestHeader, body: requestBody, json: true, timeout: timeoutInSec * 1000 * 1.1 }, (err, httpResponse, responseBody) => {

                if (err !== null) {
                    reject(err);
                    return;
                }

                if (that.plannerConfiguration.authentication) {
                    if (httpResponse) {
                        if (httpResponse.statusCode === 400) {
                            const message = "Authentication failed. Please login or update tokens.";
                            const error = new Error(message);
                            reject(error);
                            return;
                        }
                        else if (httpResponse.statusCode === 401) {
                            const message = "Invalid token. Please update tokens.";
                            const error = new Error(message);
                            reject(error);
                            return;
                        }
                    }
                }

                if (httpResponse && httpResponse.statusCode > 202) {
                    const notificationMessage = `PDDL Planning Service returned code ${httpResponse.statusCode} ${httpResponse.statusMessage}`;
                    const error = new Error(notificationMessage);
                    reject(error);
                    return;
                }

                that.processServerResponseBody(responseBody, planParser, parent, resolve, reject);
            });
        });
    }

    /** Gets timeout in seconds. */
    abstract getTimeout(): number;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsePlanSteps(planSteps: any, planParser: parser.PddlPlannerOutputParser): void {
        for (let index = 0; index < planSteps.length; index++) {
            const planStep = planSteps[index];
            const fullActionName = (planStep["name"] as string).replace('(', '').replace(')', '');
            const time = planStep["time"] ?? (index + 1) * planParser.options.epsilon;
            let duration = planStep["duration"];
            const isDurative = duration !== undefined && duration !== null;
            duration = duration ?? planParser.options.epsilon;
            const planStepObj = new PlanStep(time, fullActionName, isDurative, duration, index);
            planParser.appendStep(planStepObj);
        }
        planParser.onPlanFinished();
    }
}

export interface HttpConnectionError {
    message: string;
    /** Host name or IP address e.g. 127.0.0.1 */
    address: string;
    code: string;
    errno: string;
    port: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface HttpConnectionRefusedError extends HttpConnectionError {
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function instanceOfHttpConnectionError(object: any): object is HttpConnectionError {
    return  'address' in object && 'port' in object && 'code' in object && 'message' in object;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function instanceOfHttpConnectionRefusedError(object: any): object is HttpConnectionRefusedError {
    return (instanceOfHttpConnectionError(object)) && (object as HttpConnectionError).code === 'ECONNREFUSED';
}
