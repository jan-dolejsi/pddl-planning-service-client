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
        const body: PackagedServerRequest = {
            domain: domainFileInfo.getText(),
            problem: problemFileInfo.getText()
        };

        return Promise.resolve(body);
    }

    async processServerResponseBody(origUrl: string, responseBody: PackagedServerResponse, planParser: parser.PddlPlannerOutputParser,
        callbacks: planner.PlannerResponseHandler): Promise<Plan[]> {

        const status = responseBody.status;
        const result = responseBody.result;

        if (result && isInstanceOfSyncServerResponseResult(result)) {
            const res = result as PackageServerResponseResult;
            !isEmpty(res.output) && callbacks.handleOutput(res.output + '\n');
            res.stdout && callbacks.handleOutput(res.stdout + '\n');
            res.stderr && callbacks.handleOutput("Error: " + res.stderr + '\n');
        }

        if (status === "PENDING") {
            await sleep(500);
            return await this.checkForResults(origUrl, planParser, callbacks);
        } else if (status === undefined) {
            if (result !== undefined) {
                const urlQuery = result;
                if (typeof urlQuery === "string") {
                    const resultUrl = new URL(urlQuery, origUrl).toString();
                    return await this.checkForResults(resultUrl, planParser, callbacks);
                } else {
                    throw new Error("Element 'result should be a /check... url.");
                }
            } else {
                throw new Error("Missing 'result' element.");
            }
        } else if (status === "error") {
            if (result) {
                const res = result as PackageServerResponseResult
                const resultOutput = res.output;
                if (!isEmpty(resultOutput)) {
                    callbacks.handleOutput(resultOutput);
                }

                const resultError = res.error;
                if (resultError) {
                    callbacks.handleOutput(resultError);
                }
                return [];
            }
            else {
                throw new Error("An error occurred while solving the planning problem: " + JSON.stringify(result));
            }
        }
        else if (status === "ok" && result) {
            // this branch is here for backward compatibility with the /solve handling PlannerSyncService
            const res = result as PackageServerResponseResult

            const resultOutput = res.output;
            if (!isEmpty(resultOutput)) {
                callbacks.handleOutput(resultOutput + '\n');
            }

            if (res.plan) {
                this.convertPlanSteps(res.plan, planParser);
            }

            const plans = planParser.getPlans();
            if (plans.length > 0) {
                callbacks.handlePlan(plans[0]);
            }
            else {
                callbacks.handleOutput('No plan found.\n');
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


/** Planner package service request body. */
interface PackagedServerRequest extends ServerRequest {
    domain: string;
    problem: string;
}

/** Planner package service response body. */
interface PackagedServerResponse extends ServerResponse {
    status?: "PENDING" | "error" | "ok";
    result?: CallbackUrl | PackageServerResponseResult;
}

/** Used when the planning request was just submitted. */
type CallbackUrl = string;

function isInstanceOfSyncServerResponseResult(object: CallbackUrl | PackageServerResponseResult): boolean {
    return !(typeof (object) === "string");
}

interface PackageServerResponseResult {
    output: string
    error: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan?: any;
    stderr?: string;
    stdout?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isEmpty(obj: any | undefined): boolean {
    return !obj || Object.keys(obj).length === 0;
}