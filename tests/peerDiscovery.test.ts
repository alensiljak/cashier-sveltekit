/*
 * Test for peer discovery functionality
 * Note: This is a basic test since the full functionality requires browser APIs
 */

import { expect, test } from 'vitest';
import { PeerDiscovery } from '../src/lib/utils/peerDiscovery';

test('PeerDiscovery should initialize correctly', () => {
    const testPeerId = 'test-peer-123';
    const peerDiscovery = new PeerDiscovery(testPeerId);

    // Test that it initializes
    expect(peerDiscovery).toBeDefined();
    expect(peerDiscovery).toBeInstanceOf(PeerDiscovery);
});

test('PeerDiscovery should have expected methods', () => {
    const testPeerId = 'test-peer-456';
    const peerDiscovery = new PeerDiscovery(testPeerId);

    // Test that expected methods exist
    expect(peerDiscovery.startDiscovery).toBeDefined();
    expect(peerDiscovery.stopDiscovery).toBeDefined();
    expect(peerDiscovery.getPeers).toBeDefined();
    expect(peerDiscovery.onPeersUpdatedCallback).toBeDefined();

    // Test that methods are functions
    expect(typeof peerDiscovery.startDiscovery).toBe('function');
    expect(typeof peerDiscovery.stopDiscovery).toBe('function');
    expect(typeof peerDiscovery.getPeers).toBe('function');
    expect(typeof peerDiscovery.onPeersUpdatedCallback).toBe('function');
});

test('PeerDiscovery getPeers should return array', () => {
    const testPeerId = 'test-peer-789';
    const peerDiscovery = new PeerDiscovery(testPeerId);

    const peers = peerDiscovery.getPeers();
    expect(Array.isArray(peers)).toBe(true);
    expect(peers.length).toBe(0);
});