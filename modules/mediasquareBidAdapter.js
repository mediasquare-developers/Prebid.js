import { ajax } from '../src/ajax.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER, NATIVE, VIDEO } from '../src/mediaTypes.js';
import { getRefererInfo } from '../src/refererDetection.js';
import { ortbConverter } from '../libraries/ortbConverter/converter.js';
import { deepAccess, deepSetValue } from '../src/utils.js';

/**
 * @typedef {import('../src/adapters/bidderFactory.js').BidRequest} BidRequest
 * @typedef {import('../src/adapters/bidderFactory.js').Bid} Bid
 * @typedef {import('../src/adapters/bidderFactory.js').ServerResponse} ServerResponse
 * @typedef {import('../src/adapters/bidderFactory.js').SyncOptions} SyncOptions
 * @typedef {import('../src/adapters/bidderFactory.js').UserSync} UserSync
 * @typedef {import('../src/adapters/bidderFactory.js').validBidRequests} validBidRequests
 */

const BIDDER_CODE = 'mediasquare';
const BIDDER_URL_ORTB = 'https://pbs-front.mediasquare.fr/ortb';
const BIDDER_URL_TIMEOUT = 'https://pbs-front.mediasquare.fr/timeout';

const converter = ortbConverter({
  context: {
    netRevenue: true,
    ttl: 300,
    currency: 'USD'
  },
  imp(buildImp, bidRequest, context) {
    const imp = buildImp(bidRequest, context);
    if (bidRequest.params) {
      deepSetValue(imp, 'ext.bidder', bidRequest.params);
    }
    return imp;
  }
});

export const spec = {
  code: BIDDER_CODE,
  gvlid: 791,
  aliases: ['msq'], // short code
  supportedMediaTypes: [BANNER, NATIVE, VIDEO],
  /**
   * Determines whether or not the given bid request is valid.
   *
   * @param {BidRequest} bid The bid params to validate.
   * @return boolean True if this is a valid bid, and false otherwise.
   */
  isBidRequestValid: function(bid) {
    return !!((bid.params.owner && bid.params.code) || bid.params.adunit);
  },
  /**
   * Make a server request from the list of BidRequests.
   *
   * @param {Array} validBidRequests - an array of bids
   * @param {Object} bidderRequest
   * @return {Object} Info describing the request to the server.
   */
  buildRequests: function(validBidRequests, bidderRequest) {
    return ortbBuildRequests(validBidRequests, bidderRequest);
  },
  /**
   * Unpack the response from the server into a list of bids.
   *
   * @param {ServerResponse} serverResponse A successful response from the server.
   * @return {Bid[]} An array of bids which were nested inside the server.
   */
  interpretResponse: function(serverResponse, bidRequest) {
    return ortbInterpretResponse(serverResponse, bidRequest);
  },

  /**
   * Register the user sync pixels which should be dropped after the auction.
   *
   * @param {SyncOptions} syncOptions Which user syncs are allowed?
   * @param {ServerResponse[]} serverResponses List of server's responses.
   * @return {UserSync[]} The user syncs which should be dropped.
   */
  getUserSyncs: function(syncOptions, serverResponses, gdprConsent, uspConsent) {
    return ortbGetUserSyncs(syncOptions, serverResponses, gdprConsent, uspConsent);
  },

  /**
   * Register bidder specific code, which will execute if a bid from this bidder won the auction
   * @param {Object} bid The bid that won the auction
   */
  onBidWon: function(bid) {
    return ortbOnBidWon(bid);
  },

  onTimeout: function(timeoutData) {
    return onTimeout(timeoutData);
  }
};

function ortbBuildRequests(validBidRequests, bidderRequest) {
  return {
    method: 'POST',
    url: BIDDER_URL_ORTB,
    data: converter.toORTB({ bidRequests: validBidRequests, bidderRequest })
  };
}

function ortbInterpretResponse(serverResponse, bidRequest) {
  if (!serverResponse || !serverResponse.body) {
    return [];
  }
  return converter.fromORTB({ request: bidRequest.data, response: serverResponse.body }).bids;
}

function ortbGetUserSyncs(syncOptions, serverResponses, gdprConsent, uspConsent) {
  if (!Array.isArray(serverResponses) || serverResponses.length === 0) {
    return [];
  }

  const supportedUserSyncs = [];

  serverResponses.forEach(response => {
    const userSyncs = deepAccess(response, 'body.ext.usersyncs');
    if (!Array.isArray(userSyncs)) {
      return;
    }

    userSyncs.forEach(sync => {
      if (!sync || typeof sync.url !== 'string' || typeof sync.type !== 'string') {
        return;
      }

      if ((sync.type === 'iframe' && syncOptions.iframeEnabled) || (sync.type === 'image' && syncOptions.pixelEnabled)) {
        supportedUserSyncs.push({
          type: sync.type,
          url: sync.url
        });
      }
    });
  });

  return supportedUserSyncs;
}

function onTimeout(timeoutData) {
  if (!Array.isArray(timeoutData) || timeoutData.length === 0) {
    return;
  }

  const refererInfo = getRefererInfo();
  const refererPage = refererInfo.page || refererInfo.topmostLocation || '';
  const payload = {
    event: 'timeout',
    eventSource: BIDDER_CODE,
    timeoutCount: timeoutData.length,
    timeout: timeoutData[0]?.timeout,
    bidIds: timeoutData.map(entry => entry.bidId).filter(Boolean),
    adUnitCodes: timeoutData.map(entry => entry.adUnitCode).filter(Boolean),
    auctionIds: timeoutData.map(entry => entry.auctionId).filter(Boolean),
    timeoutData: timeoutData,
    page: encodeURIComponent(refererPage),
    pbjs: '$prebid.version$'
  };

  ajax(BIDDER_URL_TIMEOUT, null, JSON.stringify(payload), { method: 'POST', withCredentials: true });
  return true;
}

function ortbOnBidWon(bid) {
  if (!bid || bid.mediaType === 'video') {
    return;
  }
  if (bid.burl) {
    ajax(bid.burl, null, null);
    return true;
  }
}

registerBidder(spec);
