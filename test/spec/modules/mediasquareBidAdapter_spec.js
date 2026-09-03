import { expect } from 'chai';
import { spec } from 'modules/mediasquareBidAdapter.js';
import { server } from 'test/mocks/xhr.js';

describe('MediaSquare bid adapter tests', function () {
  const BIDDER_CODE = 'mediasquare';
  const DEFAULT_PARAMS = [{
    adUnitCode: 'banner-div',
    bidId: 'aaaa1234',
    auctionId: 'bbbb1234',
    transactionId: 'cccc1234',
    ortb2Imp: {
      ext: {
        tid: 'cccc1234',
      }
    },
    mediaTypes: {
      banner: {
        sizes: [
          [300, 250]
        ]
      }
    },
    bidder: BIDDER_CODE,
    params: {
      owner: 'test',
      code: 'publishername_atf_desktop_rg_pave'
    },
  }];

  const DEFAULT_OPTIONS = {
    ortb2: {
      regs: {
        ext: {
          dsa: {
            dsarequired: '1',
            pubrender: '2',
            datatopub: '3',
            transparency: [{
              domain: 'test.com',
              dsaparams: [1, 2, 3]
            }]
          }
        }
      }
    },
    userIdAsEids: [{
      source: 'superid.com',
      uids: [{
        id: '12345678',
        atype: 1
      }]
    }],
    gdprConsent: {
      gdprApplies: true,
      consentString: 'BOzZdA0OzZdA0AGABBENDJ-AAAAvh7_______9______9uz_Ov_v_f__33e8__9v_l_7_-___u_-33d4-_1vf99yfm1-7ftr3tp_87ues2_Xur__79__3z3_9pxP78k89r7337Mw_v-_v-b7JCPN_Y3v-8Kg',
      vendorData: {}
    },
    refererInfo: {
      page: 'https://www.prebid.org/the/link/to/the/page',
      referer: 'https://www.prebid.org',
      canonicalUrl: 'https://www.prebid.org/the/link/to/the/page'
    },
    uspConsent: '111222333'
  };

  it('Verifies bidder code and aliases', function () {
    expect(spec.code).to.equal(BIDDER_CODE);
    expect(spec.aliases).to.deep.equal(['msq']);
  });

  it('Verifies bid request validation', function () {
    expect(spec.isBidRequestValid(DEFAULT_PARAMS[0])).to.equal(true);
    expect(spec.isBidRequestValid({
      bidder: BIDDER_CODE,
      params: { adunit: 'publishername_atf_desktop_rg_pave' }
    })).to.equal(true);
    expect(spec.isBidRequestValid({
      bidder: BIDDER_CODE,
      params: {}
    })).to.equal(false);
  });

  it('Verifies ORTB build request', function () {
    const request = spec.buildRequests(DEFAULT_PARAMS, DEFAULT_OPTIONS);
    expect(request).to.have.property('url').and.to.equal('https://pbs-front.mediasquare.fr/ortb');
    expect(request).to.have.property('method').and.to.equal('POST');
    expect(request).to.have.property('data').that.is.an('object');
    expect(request.data).to.have.property('imp').that.is.an('array').with.lengthOf(1);
    expect(request.data.imp[0]).to.have.nested.property('ext.bidder.owner', 'test');
    expect(request.data.imp[0]).to.have.nested.property('ext.bidder.code', 'publishername_atf_desktop_rg_pave');
  });

  it('Verifies ORTB interpretResponse maps bid.burl to the returned bid object', function () {
    const request = spec.buildRequests(DEFAULT_PARAMS, DEFAULT_OPTIONS);
    const serverResponse = {
      body: {
        id: 'ortb-response',
        seatbid: [{
          bid: [{
            id: 'bid-1',
            impid: request.data.imp[0].id,
            price: 2.34,
            burl: 'https://example.com/win?price=${AUCTION_PRICE}',
            adm: '<div>test</div>',
            w: 300,
            h: 250,
            mtype: 1
          }]
        }]
      }
    };

    const response = spec.interpretResponse(serverResponse, request);
    expect(response).to.have.lengthOf(1);
    expect(response[0]).to.have.property('burl', 'https://example.com/win?price=${AUCTION_PRICE}');
  });

  it('Verifies ORTB interpretResponse handles empty response bodies safely', function () {
    expect(spec.interpretResponse({ body: undefined }, { data: {} })).to.be.an('array').that.is.empty;
    expect(spec.interpretResponse({ body: null }, { data: {} })).to.be.an('array').that.is.empty;
  });

  it('Verifies ORTB user sync extraction and filtering', function () {
    const syncResponse = {
      body: {
        ext: {
          usersyncs: [
            { type: 'iframe', url: 'http://www.iframe-sync.com/' },
            { type: 'image', url: 'http://www.pixel-sync.com/' },
            { type: 'custom', url: 'http://www.other-sync.com/' },
            { url: 'http://www.missing-type.com/' },
            { type: 'image' },
            null
          ]
        }
      }
    };

    const pixelSyncs = spec.getUserSyncs({ pixelEnabled: true, iframeEnabled: false }, [syncResponse], DEFAULT_OPTIONS.gdprConsent, DEFAULT_OPTIONS.uspConsent);
    expect(pixelSyncs).to.deep.equal([{ type: 'image', url: 'http://www.pixel-sync.com/' }]);

    const iframeSyncs = spec.getUserSyncs({ pixelEnabled: false, iframeEnabled: true }, [syncResponse], DEFAULT_OPTIONS.gdprConsent, DEFAULT_OPTIONS.uspConsent);
    expect(iframeSyncs).to.deep.equal([{ type: 'iframe', url: 'http://www.iframe-sync.com/' }]);
  });

  it('Verifies ORTB user sync returns empty without usersyncs', function () {
    expect(spec.getUserSyncs({}, null, DEFAULT_OPTIONS.gdprConsent, DEFAULT_OPTIONS.uspConsent)).to.be.an('array').that.is.empty;
    expect(spec.getUserSyncs({}, [{}], DEFAULT_OPTIONS.gdprConsent, DEFAULT_OPTIONS.uspConsent)).to.be.an('array').that.is.empty;
  });

  it('Verifies timeout event sends timeout payload', function () {
    const initialRequestCount = server.requests.length;
    const timeoutData = [{
      bidder: BIDDER_CODE,
      bidId: 'aaaa1234',
      auctionId: 'bbbb1234',
      adUnitCode: 'banner-div',
      timeout: 3000
    }];

    const result = spec.onTimeout(timeoutData);
    expect(result).to.equal(true);
    expect(server.requests.length).to.equal(initialRequestCount + 1);

    const request = server.requests[server.requests.length - 1];
    expect(request.url).to.equal('https://pbs-front.mediasquare.fr/timeout');

    const payload = JSON.parse(request.requestBody);
    expect(payload).to.have.property('event', 'timeout');
    expect(payload).to.have.property('eventSource', BIDDER_CODE);
    expect(payload).to.have.property('timeoutCount', 1);
    expect(payload).to.have.property('timeout', 3000);
    expect(payload).to.have.property('bidIds').that.deep.equals(['aaaa1234']);
    expect(payload).to.have.property('adUnitCodes').that.deep.equals(['banner-div']);
    expect(payload).to.have.property('auctionIds').that.deep.equals(['bbbb1234']);
    expect(payload).to.have.property('timeoutData').that.deep.equals(timeoutData);
    expect(payload).to.have.property('page');
    expect(payload).to.have.property('pbjs', '$prebid.version$');
  });

  it('Verifies timeout event is ignored for empty timeout array', function () {
    const initialRequestCount = server.requests.length;
    const result = spec.onTimeout([]);
    expect(result).to.equal(undefined);
    expect(server.requests.length).to.equal(initialRequestCount);
  });

  it('Verifies ORTB onBidWon fires burl for display bids', function () {
    const initialRequestCount = server.requests.length;
    const won = spec.onBidWon({
      bidId: 'aaaa1234',
      cpm: 1.23,
      mediaType: 'banner',
      burl: 'https://example.com/win?price=${AUCTION_PRICE}'
    });

    expect(won).to.equal(true);
    expect(server.requests.length).to.equal(initialRequestCount + 1);
    expect(server.requests[server.requests.length - 1].url).to.equal('https://example.com/win?price=${AUCTION_PRICE}');
  });

  it('Verifies ORTB onBidWon skips video bids', function () {
    const initialRequestCount = server.requests.length;
    const won = spec.onBidWon({
      bidId: 'aaaa1234',
      mediaType: 'video',
      burl: 'https://example.com/win?price=${AUCTION_PRICE}'
    });

    expect(won).to.equal(undefined);
    expect(server.requests.length).to.equal(initialRequestCount);
  });
});
