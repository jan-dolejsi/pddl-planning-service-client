/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { planner, Plan, ProblemInfo, DomainInfo, parser, PlanStep } from 'pddl-workspace';
import { postJson } from './httpUtils';
import { URL } from 'url';
import { OutgoingHttpHeaders } from 'http';


/** Abstract implementation of both sync/async planning service client. */
export abstract class PlannerService<I extends ServerRequest, O extends ServerResponse> extends planner.Planner {

    constructor(plannerUrl: string, plannerConfiguration: planner.PlannerRunConfiguration, providerConfiguration: planner.ProviderConfiguration) {
        super(plannerUrl, plannerConfiguration, providerConfiguration);
    }

    abstract createRequestBody(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo): Promise<I | null>;

    abstract createUrl(): string;

    abstract processServerResponseBody(origUrl: string, responseBody: O, planParser: parser.PddlPlannerOutputParser,
        parent: planner.PlannerResponseHandler): Promise<Plan[]>;

    async plan(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo, planParser: parser.PddlPlannerOutputParser, parent: planner.PlannerResponseHandler): Promise<Plan[]> {
        parent.handleOutput(`Planning service: ${this.plannerPath}\nDomain: ${domainFileInfo.name}, Problem: ${problemFileInfo.name}\n`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let requestHeader: OutgoingHttpHeaders = {};
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

        const output = await postJson<O>(new URL(url), requestBody as never, {
            isAuthenticated: this.plannerConfiguration.authentication !== undefined,
            serviceFriendlyName: 'PDDL Planning Service',
            headers: requestHeader,
            json: true,
            timeout: timeoutInSec * 1000 * 1.1,
        });

        const plans = await this.processServerResponseBody(url, output, planParser, parent);

        return plans;
    }

    /** Gets timeout in seconds. */
    abstract getTimeout(): number;

    convertPlanSteps(planSteps: JsonPlanStep[], planParser: parser.PddlPlannerOutputParser): void {
        for (let index = 0; index < planSteps.length; index++) {
            const planStep = planSteps[index];
            const fullActionName = planStep.name.replace('(', '').replace(')', '');
            const time = planStep.time ?? (index + 1) * planParser.options.epsilon;
            let duration = planStep.duration;
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
    return 'address' in object && 'port' in object && 'code' in object && 'message' in object;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function instanceOfHttpConnectionRefusedError(object: any): object is HttpConnectionRefusedError {
    return (instanceOfHttpConnectionError(object)) && (object as HttpConnectionError).code === 'ECONNREFUSED';
}

/** Server request body. */
export interface ServerRequest {

}

/** Server response body. */
export interface ServerResponse {

}

interface JsonPlanStep {
    /** Action name. */
    name: string;
    time?: number;
    duration?: number;
}