import { RatelimitHeaders, HeaderNames, StatusCodes, Details, TopLikes } from './types';

import fetch, { Request, Response as NodeFetchResponse, Headers } from 'node-fetch';
import { DiscordBioError, RatelimitError } from './errors';
import { BASE_URL, VERSION, Endpoints, PARAM_INDICATOR } from './routes';
import { Bucket } from './bucket';
import { Collection, CollectionOptions } from './collection';

export interface ClientOptions {
  cache?: boolean | {
    userProfiles?: boolean | CollectionOptions<string, Details.Payload>,
  }
}

/**
 * The main REST client for interfacing with discord.bio.
 */
export class Client {
    /**
     * The ratelimit bucket that helps prevent ratelimits. Not implemented yet
     */
    public bucket: Bucket = new Bucket();

    /**
     * The most recently recieved ratelimit headers, if any.
     */
    public ratelimitHeaders: RatelimitHeaders = {
      [HeaderNames.RATELIMIT_RESET]: null,
      [HeaderNames.RATELIMIT_REMAINING]: null,
      [HeaderNames.RATELIMIT_LIMIT]: null
    }

    /**
     * The cache of recently fetched user profiles.
     */
    public userProfiles: Collection<string, Details.Response> | null

    constructor (options: ClientOptions = {}) {
      if (options.cache === false) {
        this.userProfiles = null;
      } else {
        let userProfileOptions = {};
        if (options.cache !== true && typeof options.cache?.userProfiles === 'object') {
          userProfileOptions = options.cache?.userProfiles;
        }
        this.userProfiles = new Collection<string, Details.Response>(userProfileOptions);
      }
    }

    /**
     * Constructs a fully-qualified path from the base URL, version, and endpoint/parameters. This function is internal and should not be used in end-user code.
     */
    private constructPath (endpoint: string, params?: {[key: string]: string}): string {
      let path = `${BASE_URL}${VERSION}${endpoint}`;
      if (params) {
        Object.keys(params).forEach(param => {
          path = path.replace(`${PARAM_INDICATOR}${param}`, params[param]);
        });
      }
      return path;
    }

    /**
     * Fetches a user from discord.bio.
     * @param searchQuery The user ID or slug to search for
     */
    public async fetchUserDetails (searchQuery: string): Promise<Details.Response> {
      if (this.userProfiles?.get(searchQuery)) {
        return <Details.Response> this.userProfiles.get(searchQuery);
      }
      const path = this.constructPath(Endpoints.DETAILS, {
        [Endpoints.DETAILS.split(PARAM_INDICATOR)[1]]: searchQuery
      });
      const res = await this.request(path);
      if (this.userProfiles) this.userProfiles.set(searchQuery, res);
      return res;
    }

    /**
     * Fetches the top liked users on discord.bio.
     */
    public async fetchTopUsers (): Promise<TopLikes.Response> {
      const path = this.constructPath(Endpoints.TOP_LIKES);
      return await this.request(path);
    }

    /**
     * Sends a request to a specified path and return the response as json. Mostly for internal use. This function updates the stored ratelimit headers.
     * @param path The path to send the request to
     */
    public async request (path: string): Promise<any> {
      const request = new Request(path);
      const response = await fetch(request);
      this.updateRatelimitHeaders(response.headers);
      if (![StatusCodes.SUCCESS, StatusCodes.RATELIMIT].includes(response.status)) {
        throw new DiscordBioError(await response.text(), request, response);
      } else if (response.status === StatusCodes.RATELIMIT) {
        throw new RatelimitError(await response.text(), request, response);
      }
      let json;
      try {
        json = await response.json();
      } catch (e) {
        throw new DiscordBioError('Invalid JSON returned from request - API down?', request, response);
      }
      return json;
    }

    /**
     * Updates the stored ratelimit headers. This function is internal and should not be used in end-user code.
     */
    private updateRatelimitHeaders (headers: Headers) {
      const ratelimitHeaders = [HeaderNames.RATELIMIT_RESET, HeaderNames.RATELIMIT_REMAINING, HeaderNames.RATELIMIT_RESET];
      for (const headerName of ratelimitHeaders) {
        const headerValue = headers.get(headerName);
        if (headerValue) this.ratelimitHeaders[headerName] = parseInt(headerValue);
      }
    }
}
