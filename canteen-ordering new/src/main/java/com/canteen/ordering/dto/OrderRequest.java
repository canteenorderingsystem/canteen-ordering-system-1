package com.canteen.ordering.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record OrderRequest(
        @Size(max = 60, message = "Name must be at most 60 characters")
        String customerName,

        @Size(max = 500, message = "Notes must be at most 500 characters")
        String notes,

        @NotEmpty(message = "Order must contain at least one item")
        List<@Valid OrderItemRequest> items
) {
}
