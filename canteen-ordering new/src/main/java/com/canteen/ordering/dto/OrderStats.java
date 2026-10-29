package com.canteen.ordering.dto;

public record OrderStats(
        long totalOrders,
        long pending,
        long preparing,
        long ready,
        long completed,
        long cancelled,
        int nextQueueNumber
) {
}
