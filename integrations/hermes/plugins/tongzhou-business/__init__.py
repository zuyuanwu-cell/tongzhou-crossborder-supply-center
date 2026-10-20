"""Hermes registration entrypoint for the Tongzhou business plugin."""

from .client import TongzhouBridgeClient
from .tools import register_tools


def register(ctx):
    register_tools(ctx, TongzhouBridgeClient())
