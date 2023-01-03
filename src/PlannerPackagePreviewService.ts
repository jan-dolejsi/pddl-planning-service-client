/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Plan, ProblemInfo, DomainInfo, parser, planner } from 'pddl-workspace';
import { PlannerService, ServerRequest, ServerResponse } from './PlannerService';
import { URL } from "url";
import { getJson } from './httpUtils';

/** Wraps the `/package/xyz/solve` planning-as-a-service web service interface. */
export class PlannerPackagePreviewService extends PlannerService<PackagedServerRequest, PackagedServerResponse> {

    constructor(plannerUrl: string, plannerConfiguration: planner.PlannerRunConfiguration, providerConfiguration: planner.ProviderConfiguration) {
        super(plannerUrl, plannerConfiguration, providerConfiguration);
    }

    createUrl(): string {

        let url = this.plannerPath;
        if (this.plannerConfiguration.options) {
            url = `${url}?${this.plannerConfiguration.options}`;
        }
        return url;
    }

    getTimeout(): number {
        return 20;
    }

    createRequestBody(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo): Promise<PackagedServerRequest | null> {
        let body: PackagedServerRequest = {
            domain: domainFileInfo.getText(),
            problem: problemFileInfo.getText()
        };
        body = Object.assign(body, this.plannerConfiguration);
        return Promise.resolve(body);
    }

    async processServerResponseBody(origUrl: string, responseBody: PackagedServerResponse, planParser: parser.PddlPlannerOutputParser,
        callbacks: planner.PlannerResponseHandler): Promise<Plan[]> {

        const status = responseBody.status;
        const result = responseBody.result;

        if (result && isInstanceOfSyncServerResponseResult(result)) {
            const res = result as PackagedServerResponseResult;
            !isEmpty(res.output) && typeof (res.output) === "string" && callbacks.handleOutput(res.output + '\n');
            res.stdout && callbacks.handleOutput(res.stdout + '\n');
            res.stderr && callbacks.handleOutput("Error: " + res.stderr + '\n');
        }

        if (status === "PENDING") {
            await sleep(500);
            return await this.checkForResults(origUrl, planParser, callbacks);
        } else if (status === "error" || responseBody.Error) {
            if (result) {
                const res = result as PackagedServerResponseResult

                const resultError = res.error;
                if (resultError) {
                    callbacks.handleOutput(resultError);
                }
                return [];
            }
            else if (responseBody.Error) {
                throw new Error(responseBody.Error);
            } else {
                throw new Error("An error occurred while solving the planning problem: " + JSON.stringify(result));
            }
        } else if (status === undefined) {
            if (result !== undefined) {
                const urlQuery = result;
                if (typeof urlQuery === "string") {
                    const resultUrl = new URL(urlQuery, origUrl).toString();
                    return await this.checkForResults(resultUrl, planParser, callbacks);
                } else {
                    throw new Error("Element 'result should be a /check... url.");
                }
            } else if (Object.keys(responseBody).some(key => key.includes('plan'))) {
                const responseBody1 = responseBody as never as PlanUtilsServerResponseBody;
                responseBody1.stdout && callbacks.handleOutput(responseBody1.stdout + '\n');
                responseBody1.stderr && callbacks.handleOutput("Error: " + responseBody1.stderr + '\n');
                Object.keys(responseBody)
                    .filter(key => key.includes('plan'))
                    .forEach(key => {
                        const planText = responseBody1[key];
                        planParser.appendBuffer(planText);
                        planParser.onPlanFinished();
                    });

                const plans = planParser.getPlans();
                if (plans.length > 0) {
                    callbacks.handlePlan(plans[0]);
                } else {
                    callbacks.handleOutput('No plan found in the planner output.\n');
                }
                return plans;
            } else {
                throw new Error("Missing 'result' or '*plan*' elements.");
            }
        }
        else if (status === "ok" && result) {
            const res = result as PackagedServerResponseResult

            if (res.output) {
                Object.keys(res.output).forEach(key => {
                    const planText = res.output[key];
                    planParser.appendBuffer(planText);
                    planParser.onPlanFinished();
                });
            }

            const plans = planParser.getPlans();
            if (plans.length > 0) {
                callbacks.handlePlan(plans[0]);
            }
            else {
                callbacks.handleOutput(`Planner output: ${JSON.stringify(res.output)}`);
                callbacks.handleOutput('No plan found in the planner output.\n');
            }

            return plans;
        } else {
            throw new Error(`Planner service failed with status ${status}.`);
        }
    }

    async checkForResults(origUrl: string, planParser: parser.PddlPlannerOutputParser, callbacks: planner.PlannerResponseHandler): Promise<Plan[]> {
        console.log(`Checking for results at ${origUrl} ...`);
        const response = await getJson<PackagedServerResponse>(new URL(origUrl))
        return await this.processServerResponseBody(origUrl, response, planParser, callbacks);
    }
}


function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export type PackagedServerRequestArgs = { [key: string]: number | string | boolean };

/** Planner package service request body. */
interface PackagedServerRequest extends ServerRequest {
    domain: string;
    problem: string;
}

/** Planner package service response body. */
interface PackagedServerResponse extends ServerResponse {
    status?: "PENDING" | "error" | "ok";
    result?: CallbackUrl | PackagedServerResponseResult;

    /** @deprecated but populated by the forbid iterative topk planner, when it is missing a mandatory argument*/
    Error: string;
}

/** Used when the planning request was just submitted. */
type CallbackUrl = string;

function isInstanceOfSyncServerResponseResult(object: CallbackUrl | PackagedServerResponseResult): boolean {
    return !(typeof (object) === "string");
}

type PackagedServerResponseResultOutput = { [key: string]: string }; /*{
    plan?: string; // many planners populate this
    sas_plan?: string; // lama-first populates the following one for some reason
    // sas_plan.1: string// but!! forbid iterative topk populates sas_plan.N
};*/

interface PackagedServerResponseResult {
    output: PackagedServerResponseResultOutput;
    error: string;
    stderr?: string;
    stdout?: string;
}

interface PlanUtilsServerResponseBody {
    stderr: string;
    stdout: string;
    [key: string]: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isEmpty(obj: any | undefined): boolean {
    return !obj || Object.keys(obj).length === 0;
}
