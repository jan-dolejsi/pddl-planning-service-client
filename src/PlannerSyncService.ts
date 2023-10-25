/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Plan, ProblemInfo, DomainInfo, parser, planner } from 'pddl-workspace';
import { PlannerService, ServerRequest, ServerResponse } from './PlannerService';

/** Wraps the `/solve` planning web service interface. */
export class PlannerSyncService extends PlannerService<SyncServerRequest, SyncServerResponse> {

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
        return 60;
    }

    createRequestBody(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo): Promise<SyncServerRequest | null> {
        const body: SyncServerRequest = {
            domain: domainFileInfo.getText(),
            problem: problemFileInfo.getText()
        };

        return Promise.resolve(body);
    }

    async processServerResponseBody(_origUrl: string, responseBody: SyncServerResponse, planParser: parser.PddlPlannerOutputParser,
        callbacks: planner.PlannerResponseHandler): Promise<Plan[]> {

        const status = responseBody.status;
        const result = responseBody.result;

        if (result) {
            !isEmpty(result.output) && callbacks.handleOutput(result.output + '\n');
            result.stdout && callbacks.handleOutput(result.stdout + '\n');
            result.stderr && callbacks.handleOutput("Error: " + result.stderr + '\n');
        }

        if (status === "error") {
            if (result) {
                const resultOutput = result.output;
                if (!isEmpty(resultOutput)) {
                    callbacks.handleOutput(resultOutput);
                }

                const resultError = result.error;
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

            const resultOutput = result.output;
            if (!isEmpty(resultOutput)) {
                callbacks.handleOutput(resultOutput + '\n');
            }

            if (result.plan) {
                this.convertPlanSteps(result.plan, planParser);
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
}


/** Sync service request body. */
interface SyncServerRequest extends ServerRequest {
    domain: string;
    problem: string;
}

/** Sync service response body. */
interface SyncServerResponse extends ServerResponse {
    status?: "error" | "ok";
    result?: SyncServerResponseResult;
}

interface SyncServerResponseResult {
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